#!/usr/bin/env bash
# Requires CLOUDFLARE_API_TOKEN with Account D1 Edit. Never echoes secrets.
set -euo pipefail
unset NPM_CONFIG_PREFIX || true
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-2b738f63f372671143e317e7cdb0e15c}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
test -n "${CLOUDFLARE_API_TOKEN:-}" || { echo "CLOUDFLARE_API_TOKEN missing" >&2; exit 1; }

echo "== d1 create =="
CREATE_OUT="$(npx wrangler d1 create money-desk-watchman-db 2>&1 || true)"
DB_ID="$(printf '%s\n' "$CREATE_OUT" | sed -nE 's/.*database_id[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' | head -1)"
if [[ -z "$DB_ID" ]]; then
  LIST_OUT="$(npx wrangler d1 list 2>&1 || true)"
  DB_ID="$(printf '%s\n' "$LIST_OUT" | awk '/money-desk-watchman-db/ {print $1}' | head -1)"
fi
if [[ -z "$DB_ID" ]]; then
  echo "FATAL: D1 id unresolved — need Account D1 Edit" >&2
  exit 2
fi
echo "D1 id resolved (len=${#DB_ID})"

python3 - "$DB_ID" <<'PY2'
import sys, pathlib, re
db_id = sys.argv[1]
p = pathlib.Path('wrangler.toml')
t = p.read_text()
t = re.sub(r'database_id = "[^"]*"', f'database_id = "{db_id}"', t)
t = re.sub(r'preview_database_id = "[^"]*"', f'preview_database_id = "{db_id}"', t)
p.write_text(t)
print('wrangler.toml database_id updated')
PY2

echo "== secret put ADMIN_TOKEN =="
python3 - <<'PY2'
from pathlib import Path
import subprocess
tok = None
for line in Path('.dev.vars').read_text().splitlines():
    if line.startswith('ADMIN_TOKEN='):
        tok = line.split('=', 1)[1].strip()
assert tok, 'ADMIN_TOKEN missing in .dev.vars'
subprocess.run(['npx', 'wrangler', 'secret', 'put', 'ADMIN_TOKEN'], input=tok.encode(), check=True)
print('ADMIN_TOKEN secret: set')
PY2

echo "== deploy =="
npx wrangler deploy | tee /tmp/mdw-deploy.out
URL="$(sed -nE 's#.*(https://money-desk-watchman\.[^[:space:]]+\.workers\.dev).*#\1#p' /tmp/mdw-deploy.out | head -1)"
echo "URL=$URL"
test -n "$URL"

echo "== health =="
CODE="$(curl -sS -o /tmp/mdw-health.json -w '%{http_code}' "$URL/health")"
echo "HTTP $CODE"
cat /tmp/mdw-health.json; echo
test "$CODE" = "200"

ADMIN="$(python3 -c "from pathlib import Path; print([l.split('=',1)[1].strip() for l in Path('.dev.vars').read_text().splitlines() if l.startswith('ADMIN_TOKEN=')][0])")"

echo "== admin run-check =="
curl -sS -X POST -H "x-admin-token: $ADMIN" "$URL/admin/run-check" | tee /tmp/mdw-run.json
echo

echo "== admin force-alert =="
curl -sS -X POST -H "x-admin-token: $ADMIN" "$URL/admin/force-alert" | tee /tmp/mdw-force.json
echo

echo "== d1 counts =="
npx wrangler d1 execute money-desk-watchman-db --remote --command \
  "SELECT (SELECT COUNT(*) FROM checks) AS checks, (SELECT COUNT(*) FROM alerts) AS alerts;"

mkdir -p /workspace/jarvis-os/_ops/watchman
npx wrangler d1 execute money-desk-watchman-db --remote --json --command \
  "SELECT id, ts, kind, substr(body,1,280) AS body_preview FROM alerts ORDER BY id DESC LIMIT 1;" \
  > /tmp/mdw-alert.json || true

python3 - <<'PY2'
import json, pathlib
from datetime import datetime, timezone
health = json.loads(pathlib.Path('/tmp/mdw-health.json').read_text())
out = {
  'ts': datetime.now(timezone.utc).isoformat(),
  'worker': 'money-desk-watchman',
  'health': health,
  'note': 'L3 observe-only mirror for JARVIS disk; Leo dead',
}
try:
  out['latest_alert'] = json.loads(pathlib.Path('/tmp/mdw-alert.json').read_text())
except Exception as e:
  out['latest_alert_error'] = str(e)
pathlib.Path('/workspace/jarvis-os/_ops/watchman/last.json').write_text(json.dumps(out, indent=2) + '\n')
print('wrote watchman/last.json')
PY2

echo DONE
