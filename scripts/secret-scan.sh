#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fail=0

tracked_env="$(git ls-files -- '.env' '.env.*' 2>/dev/null | grep -v -E '(^|/)\.env\.example$|(^|/)\.env\..*\.example$' || true)"
if [ -n "${tracked_env}" ]; then
  echo "[FAIL] tracked env files (should NOT be committed):"
  echo "${tracked_env}" | sed 's/^/  /'
  fail=1
fi

patterns=(
  '-----BEGIN[[:space:]]+(RSA|OPENSSH|EC)?[[:space:]]*PRIVATE[[:space:]]*KEY-----'
  'ghp_[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'AKIA[0-9A-Z]{16}'
  'AIza[0-9A-Za-z\-_]{20,}'
  'sk-[A-Za-z0-9]{20,}'
)

for p in "${patterns[@]}"; do
  hits="$(git grep -I --name-only -E "${p}" -- . 2>/dev/null || true)"
  if [ -n "${hits}" ]; then
    echo "[SUSPECT] pattern: ${p}"
    echo "${hits}" | sed 's/^/  /'
    fail=1
  fi
done

if [ "${fail}" -ne 0 ]; then
  echo "Potential secrets detected. Remove/rotate before pushing."
  exit 2
fi

echo "OK: no suspicious patterns in tracked files."
