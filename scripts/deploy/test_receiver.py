import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).with_name('receiver.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.file = self.root / 'app.py'
        self.file.write_bytes(b'old = True\n')
        self.state = {'commit': '1' * 40, 'hashes': {'app.py': r.digest(self.file.read_bytes())}}
        (self.root / 'state.json').write_text(json.dumps(self.state))
        self.request = {'action': 'apply', 'commit': '2' * 40, 'expected': self.state['hashes'],
                        'files': {'app.py': base64.b64encode(b'new = True\n').decode()}}
        for target, value in [('STORE', self.root), ('destination', lambda n: self.file),
                              ('secure_file', lambda p: p.stat()), ('healthy', lambda: True),
                              ('systemctl', lambda *a: None)]:
            patcher = patch.object(r, target, value)
            patcher.start(); self.addCleanup(patcher.stop)
        original_atomic = r.atomic_write
        def local_write(path, data, mode=0o600, gid=0):
            path.write_bytes(data)
        patcher = patch.object(r, 'atomic_write', local_write)
        patcher.start(); self.addCleanup(patcher.stop)

    def test_detects_external_changes_without_overwriting(self):
        self.file.write_bytes(b'external = True\n')
        with self.assertRaises(ValueError): r.apply(self.request, self.state)
        self.assertEqual(self.file.read_bytes(), b'external = True\n')

    def test_rejects_extra_and_missing_files(self):
        self.request['files']['dhf_app/config.py'] = ''
        with self.assertRaises(ValueError): r.validate(self.request, self.state)
        self.request['files'] = {}
        with self.assertRaises(ValueError): r.validate(self.request, self.state)

    def test_syntax_error_does_not_write(self):
        self.request['files']['app.py'] = base64.b64encode(b'def invalid(').decode()
        with self.assertRaises(SyntaxError): r.apply(self.request, self.state)
        self.assertEqual(self.file.read_bytes(), b'old = True\n')

    def test_preview_no_write_no_restart(self):
        self.request['action'] = 'preview'
        with patch.object(r, 'systemctl') as systemctl:
            result = r.apply(self.request, self.state)
            systemctl.assert_not_called()
        self.assertEqual(result['changed_files'], ['app.py'])
        self.assertEqual(self.file.read_bytes(), b'old = True\n')

    def test_success_advances_state_and_keeps_backup(self):
        with patch.object(r, 'wait_healthy', return_value=True): r.apply(self.request, self.state)
        self.assertEqual(self.file.read_bytes(), b'new = True\n')
        self.assertEqual(json.loads((self.root / 'state.json').read_text())['commit'], '2' * 40)
        self.assertFalse((self.root / 'pending.json').exists())
        self.assertEqual(len(list(self.root.glob('backup-*.json'))), 1)

    def test_failed_health_restores_old_files(self):
        with patch.object(r, 'wait_healthy', side_effect=[False, True]):
            with self.assertRaises(RuntimeError): r.apply(self.request, self.state)
        self.assertEqual(self.file.read_bytes(), b'old = True\n')
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), self.state)
        self.assertFalse((self.root / 'pending.json').exists())

    def test_failed_rollback_keeps_recovery_journal(self):
        with patch.object(r, 'wait_healthy', return_value=False):
            with self.assertRaises(RuntimeError): r.apply(self.request, self.state)
        self.assertTrue((self.root / 'pending.json').exists())


class PathTests(unittest.TestCase):
    def test_protected_paths(self):
        for name in ['../app.py', '/etc/passwd', 'dhf_app/config.py', 'html/../app.py', 'html/uploads/a', 'html/.env', 'app.py/']:
            with self.assertRaises(ValueError): r.destination(name)

    def test_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'file'
            target.write_text('data')
            link = Path(directory) / 'link'
            link.symlink_to(target)
            with self.assertRaises(ValueError): r.secure_file(link)


if __name__ == '__main__':
    unittest.main()
