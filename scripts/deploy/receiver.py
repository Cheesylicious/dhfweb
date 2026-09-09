"""Root-owned constrained receiver. No application code is imported or executed here."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

STORE = Path('/var/lib/dhf-deploy')
SERVICE = 'dhf-planer.service'
LIMIT = 16 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def destination(name):
    parts = name.split('/')
    if any(p in ('', '.', '..', 'uploads', 'instance', 'venv', '__pycache__') or p.startswith('.') for p in parts):
        raise ValueError('Forbidden path')
    if any(p == 'config.py' for p in parts):
        raise ValueError('Protected configuration')
    if name.startswith('html/'):
        return Path('/var/www/html') / name[5:]
    if name == 'app.py' or name.startswith('dhf_app/'):
        return Path('/var/www/dhf_planer_web') / name
    raise ValueError('Path outside application')


def secure_file(path):
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Unsafe parent: ' + str(parent))
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_nlink != 1:
        raise ValueError('Unsafe file: ' + str(path))
    return info


def atomic_write(path, data, mode=0o600, gid=0):
    fd, name = tempfile.mkstemp(prefix='.dhf-deploy-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fchown(handle.fileno(), 0, gid)
            os.fchmod(handle.fileno(), mode)
            os.fsync(handle.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def systemctl(*args):
    return subprocess.check_output(['/usr/bin/systemctl', *args], stderr=subprocess.DEVNULL, text=True, timeout=90).strip()


def healthy():
    try:
        if systemctl('show', SERVICE, '-p', 'User', '--value') != 'dhf-app':
            return False
        pid = int(systemctl('show', SERVICE, '-p', 'MainPID', '--value'))
        if Path('/proc').joinpath(str(pid)).stat().st_uid != pwd.getpwnam('dhf-app').pw_uid:
            return False
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        request = urllib.request.Request('http://127.0.0.1:5000/api/check_session', headers={'Host': 'dhf-planer.de'})
        try:
            response = opener.open(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code == 401 and isinstance(json.loads(response.read(65536)), dict)
    except Exception:
        return False


def wait_healthy():
    consecutive = 0
    for _ in range(20):
        consecutive = consecutive + 1 if healthy() else 0
        if consecutive >= 3:
            return True
        time.sleep(1)
    return False


def validate(request, state):
    if request.get('expected') != state['hashes']:
        raise ValueError('Server state changed since preview')
    if not re.fullmatch('[0-9a-f]{40}', request.get('commit', '')):
        raise ValueError('Invalid commit')
    files = request.get('files')
    if not isinstance(files, dict) or set(files) != set(state['hashes']):
        raise ValueError('File additions or deletions require a separate reviewed setup')
    changes = {}
    for name, encoded in files.items():
        path = destination(name)
        info = secure_file(path)
        current = path.read_bytes()
        if digest(current) != state['hashes'][name]:
            raise ValueError('Server file modified outside deployment: ' + name)
        data = base64.b64decode(encoded, validate=True)
        if name.endswith('.py'):
            compile(data, name, 'exec', flags=0, dont_inherit=True)
        if current != data:
            changes[name] = {'old': base64.b64encode(current).decode(), 'new': encoded,
                             'mode': stat.S_IMODE(info.st_mode), 'gid': info.st_gid}
    return changes


def restore(journal):
    systemctl('stop', SERVICE)
    for name, item in journal['changes'].items():
        path = destination(name)
        secure_file(path)
        atomic_write(path, base64.b64decode(item['old']), item['mode'], item['gid'])
    atomic_write(STORE / 'state.json', json.dumps(journal['previous']).encode())
    systemctl('start', SERVICE)
    if not wait_healthy():
        raise RuntimeError('Rollback files restored but service health not confirmed; manual attention needed')


def apply(request, state):
    changes = validate(request, state)
    if not healthy():
        raise RuntimeError('Initial service health check failed')
    if request.get('action') == 'preview':
        return {'mode': 'preview', 'changed_files': sorted(changes), 'commit': request['commit']}
    if not changes:
        return {'mode': 'apply', 'changed_files': [], 'message': 'No content changes; no restart'}
    journal = {'previous': state, 'changes': changes, 'commit': request['commit']}
    backup = STORE / ('backup-' + time.strftime('%Y%m%d-%H%M%S') + '-' + request['commit'][:12] + '-' + str(time.time_ns()) + '.json')
    atomic_write(backup, json.dumps(journal).encode())
    atomic_write(STORE / 'pending.json', json.dumps(journal).encode())
    writes_started = False
    try:
        systemctl('stop', SERVICE)
        # Check again after stopping the application, before the first write.
        validate(request, state)
        for name, item in changes.items():
            writes_started = True
            atomic_write(destination(name), base64.b64decode(item['new']), item['mode'], item['gid'])
        systemctl('start', SERVICE)
        if not wait_healthy():
            raise RuntimeError('Post-deployment health check failed')
        updated = {'commit': request['commit'], 'hashes': {n: digest(base64.b64decode(v)) for n, v in request['files'].items()}}
        atomic_write(STORE / 'state.json', json.dumps(updated).encode())
        (STORE / 'pending.json').unlink()
        return {'mode': 'apply', 'changed_files': sorted(changes), 'backup': str(backup)}
    except BaseException:
        if writes_started:
            restore(journal)
        else:
            systemctl('start', SERVICE)
            if not wait_healthy():
                raise RuntimeError('Aborted before file writes; service restart not confirmed') from None
        (STORE / 'pending.json').unlink()
        raise RuntimeError('Deployment failed; previous files and service restored') from None


def main():
    if os.geteuid() != 0 or len(sys.argv) != 1:
        raise SystemExit('Receiver requires the installed privileged entry point')
    with (STORE / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = sys.stdin.buffer.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError('Payload too large')
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise ValueError('Invalid request')
        action = request.get('action')
        if action not in ('status', 'preview', 'apply'):
            raise ValueError('Unsupported action')
        if (STORE / 'pending.json').exists():
            raise RuntimeError('An interrupted deployment requires recovery by the administrator before continuing')
        state = json.loads((STORE / 'state.json').read_text())
        result = state if action == 'status' else apply(request, state)
        print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
