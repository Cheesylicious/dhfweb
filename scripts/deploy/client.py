"""Runner client: authenticated status, full allowlist payload, preview or apply."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['preview', 'apply'])
    args = parser.parse_args()
    host = os.environ['DHF_SSH_HOST']
    user = os.environ['DHF_SSH_USER']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', host) or user != 'dhf-deploy':
        raise ValueError('Expected dedicated dhf-deploy account and a plain hostname')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    with tempfile.TemporaryDirectory() as tmp:
        key, known = Path(tmp) / 'key', Path(tmp) / 'known_hosts'
        key.write_text(os.environ.pop('DHF_SSH_KEY').strip() + '\n')
        key.chmod(0o600)
        known.write_text(os.environ.pop('DHF_SSH_KNOWN_HOSTS').strip() + '\n')
        subprocess.run(['ssh-keygen', '-y', '-P', '', '-f', str(key)], stdout=subprocess.DEVNULL, check=True)
        subprocess.run(['ssh-keygen', '-F', host, '-f', str(known)], stdout=subprocess.DEVNULL, check=True)
        ssh = ['ssh', '-T', '-i', str(key), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o',
               'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(known), '-o',
               'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', user + '@' + host]

        def send(payload):
            response = subprocess.run(ssh, input=json.dumps(payload), text=True, capture_output=True, timeout=420)
            if response.returncode:
                raise RuntimeError('SSH/receiver failed: ' + response.stdout[:3000] + response.stderr[:1000])
            return json.loads(response.stdout)

        state = send({'action': 'status'})
        tracked = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', commit], text=True).splitlines()
        candidate = {n for n in tracked if n == 'app.py' or n.startswith(('dhf_app/', 'html/'))}
        candidate -= {'dhf_app/config.py', 'html/index.nginx-debian.html'}
        if candidate != set(state['hashes']):
            raise ValueError('Application file set changed; additions/deletions need a separate reviewed setup')
        files = {}
        for name in state['hashes']:
            path = Path(name)
            if path.is_absolute() or '..' in path.parts or any(p.is_symlink() for p in [path, *path.parents]):
                raise ValueError('Unsafe local path')
            # Read Git blobs, not generated or untracked runner files.
            data = subprocess.check_output(['git', 'show', commit + ':' + name])
            files[name] = base64.b64encode(data).decode()
        request = {'action': 'preview', 'commit': commit, 'expected': state['hashes'], 'files': files}
        preview = send(request)
        print(json.dumps(preview, indent=2))
        if args.mode == 'apply':
            request['action'] = 'apply'
            print(json.dumps(send(request), indent=2))


if __name__ == '__main__':
    main()
