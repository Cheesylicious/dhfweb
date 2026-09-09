#!/usr/bin/env bash
# Read-only preview. No upload mode, deletion, restart or database imports.
set -euo pipefail

for key in DHF_SSH_HOST DHF_SSH_USER DHF_SSH_KEY DHF_SSH_KNOWN_HOSTS; do
    if [[ -z "${!key:-}" ]]; then
        printf 'Missing required secret: %s\n' "$key" >&2
        exit 1
    fi
done
[[ "$DHF_SSH_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid SSH host' >&2; exit 1; }
[[ "$DHF_SSH_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo 'Invalid SSH user' >&2; exit 1; }
[[ "$DHF_SSH_USER" != root ]] || { echo 'Use a dedicated non-root preview account' >&2; exit 1; }

cd "$(dirname "$0")/.."
test -f app.py
test -d dhf_app
test -d html
for cmd in ssh rsync ssh-keygen; do command -v "$cmd" >/dev/null; done

umask 077
preview_tmp=$(mktemp -d)
cleanup() { rm -f -- "$preview_tmp/key" "$preview_tmp/known_hosts"; rmdir -- "$preview_tmp"; }
trap cleanup EXIT
printf '%s\n' "$DHF_SSH_KEY" > "$preview_tmp/key"
printf '%s\n' "$DHF_SSH_KNOWN_HOSTS" > "$preview_tmp/known_hosts"
unset DHF_SSH_KEY DHF_SSH_KNOWN_HOSTS
ssh-keygen -y -P '' -f "$preview_tmp/key" >/dev/null
ssh-keygen -F "$DHF_SSH_HOST" -f "$preview_tmp/known_hosts" >/dev/null

ssh_options=(-i "$preview_tmp/key" -o IdentitiesOnly=yes -o BatchMode=yes
    -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$preview_tmp/known_hosts"
    -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2)
remote="$DHF_SSH_USER@$DHF_SSH_HOST"
ssh "${ssh_options[@]}" "$remote" \
    'command -v rsync >/dev/null && test -r /var/www/dhf_planer_web/app.py && test -d /var/www/dhf_planer_web/dhf_app && test -d /var/www/html'

# mktemp uses a simple absolute path on the GitHub-hosted Ubuntu runner.
printf -v transport 'ssh -i "%s/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=%s/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2' "$preview_tmp" "$preview_tmp"
options=(--dry-run --recursive --checksum --itemize-changes --safe-links --timeout=60
    --out-format='%i %n%L' -e "$transport"
    --exclude='uploads/' --exclude='instance/' --exclude='venv/'
    --exclude='__pycache__/' --exclude='*.pyc' --exclude='.git/'
    --exclude='.env*' --exclude='*.db*' --exclude='*.sqlite*')

echo 'Application entry point (comparison only):'
rsync "${options[@]}" app.py "$remote:/var/www/dhf_planer_web/"
echo 'Backend (configuration and runtime data excluded):'
rsync "${options[@]}" --exclude='/config.py' dhf_app/ "$remote:/var/www/dhf_planer_web/dhf_app/"
echo 'Frontend:'
rsync "${options[@]}" html/ "$remote:/var/www/html/"
echo 'Protected configuration (comparison only, never print contents):'
rsync "${options[@]}" dhf_app/config.py "$remote:/var/www/dhf_planer_web/dhf_app/"
echo 'Preview finished. No application files transferred; no services restarted.'
echo 'Server-only files are retained and are not inventoried by this preview.'
