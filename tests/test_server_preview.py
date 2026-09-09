"""Check the SSH/rsync invocation boundaries without a real server or secrets."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PreviewTest(unittest.TestCase):
    def run_preview(self, overrides=None):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            for name in ('ssh', 'rsync', 'ssh-keygen'):
                executable = base / name
                executable.write_text(
                    '#!/bin/sh\n'
                    'printf "%s" "${0##*/}" >> "$CALL_LOG"\n'
                    'for arg do printf "|%s" "$arg" >> "$CALL_LOG"; done\n'
                    'printf "\\n" >> "$CALL_LOG"\n'
                    '[ "${0##*/}" != "$FAIL_COMMAND" ]\n'
                )
                executable.chmod(0o700)
            log = base / 'calls'
            env = dict(os.environ, PATH=f'{base}:{os.environ["PATH"]}', CALL_LOG=str(log),
                       FAIL_COMMAND='', DHF_SSH_HOST='example.test', DHF_SSH_USER='dhf-preview',
                       DHF_SSH_KEY='dummy-test-key', DHF_SSH_KNOWN_HOSTS='dummy-test-host')
            env.update(overrides or {})
            result = subprocess.run(['bash', str(ROOT/'scripts/server-preview.sh')],
                                    env=env, text=True, capture_output=True)
            return result, log.read_text().splitlines() if log.exists() else []

    def test_every_comparison_is_dry_run_with_host_verification(self):
        result, calls = self.run_preview()
        self.assertEqual(result.returncode, 0, result.stderr)
        comparisons = [line.split('|') for line in calls if line.startswith('rsync|')]
        self.assertEqual(len(comparisons), 4)
        for args in comparisons:
            self.assertIn('--dry-run', args)
            self.assertIn('--checksum', args)
            self.assertNotIn('--delete', args)
            self.assertIn('--exclude=uploads/', args)
            self.assertIn('--exclude=*.db*', args)
            self.assertIn('StrictHostKeyChecking=yes', args[args.index('-e')+1])
        self.assertIn('--exclude=/config.py', comparisons[1])
        self.assertNotIn('dummy-test-key', result.stdout + result.stderr)
        self.assertNotIn('systemctl', '\n'.join(calls))

    def test_missing_secret_stops_before_connection(self):
        result, calls = self.run_preview({'DHF_SSH_KEY': ''})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_root_and_option_injection_rejected(self):
        for change in ({'DHF_SSH_USER': 'root'}, {'DHF_SSH_HOST': '-oProxyCommand=bad'}):
            with self.subTest(change=change):
                result, calls = self.run_preview(change)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])

    def test_rsync_error_stops_preview(self):
        result, calls = self.run_preview({'FAIL_COMMAND': 'rsync'})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sum(c.startswith('rsync|') for c in calls), 1)

    def test_unknown_host_stops_before_connection(self):
        result, calls = self.run_preview({'FAIL_COMMAND': 'ssh-keygen'})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c.startswith(('ssh|', 'rsync|')) for c in calls))


if __name__ == '__main__':
    unittest.main()
