#!/usr/bin/env bash
set -euo pipefail

# Require explicit service IDs so this script can never accidentally query another app's deployment.
if [[ -z "${RENDER_SERVICE_ID:-}" ]]; then
  echo "ERROR: Missing RENDER_SERVICE_ID (must be explicitly provided)"
  exit 1
fi

if [[ -z "${NETLIFY_SITE_ID:-}" ]]; then
  echo "ERROR: Missing NETLIFY_SITE_ID (must be explicitly provided)"
  exit 1
fi

if [[ -z "${RENDER_API_KEY:-}" ]]; then
  echo "ERROR: Missing RENDER_API_KEY"
  exit 1
fi

if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]]; then
  echo "ERROR: Missing NETLIFY_AUTH_TOKEN"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: Missing python3 (required)"
  exit 1
fi

if ! command -v netlify >/dev/null 2>&1; then
  echo "ERROR: Missing netlify CLI (required for Netlify env checks)"
  exit 1
fi

WEB_DIR="$(dirname "$0")/../web"
if [[ ! -d "$WEB_DIR" ]]; then
  echo "ERROR: Missing web directory at $WEB_DIR"
  exit 1
fi

echo "Checking Render env vars for $RENDER_SERVICE_ID..."
render_required=(
  DATABASE_URL
  RAILS_MASTER_KEY
  SECRET_KEY_BASE
  CLERK_JWKS_URL
  RESEND_API_KEY
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION
)

render_env_url="https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars"
render_http_code=$(curl -sS -o /tmp/hafagolf_render_env.json -w '%{http_code}' -H "Authorization: Bearer $RENDER_API_KEY" "$render_env_url")

if [[ "$render_http_code" != "200" ]]; then
  echo "ERROR: Render env API failed: HTTP $render_http_code ($render_env_url)"
  exit 1
fi

if ! python3 - <<'PYJSON' >/tmp/hafagolf_render_keys.txt
import json
from pathlib import Path
raw = Path('/tmp/hafagolf_render_env.json').read_text()
arr = json.loads(raw)
keys = sorted({(x.get('key') or (x.get('envVar') or {}).get('key')) for x in arr if isinstance(x, dict)})
for k in keys:
    if k:
        print(k)
PYJSON
then
  echo "ERROR: Render env API returned invalid JSON"
  exit 1
fi

for key in "${render_required[@]}"; do
  if ! grep -qx "$key" /tmp/hafagolf_render_keys.txt; then
    echo "ERROR: Render missing: $key"
    exit 1
  fi
  echo "OK Render: $key"
done

if ! grep -Eqx "AWS_BUCKET|AWS_S3_BUCKET" /tmp/hafagolf_render_keys.txt; then
  echo "ERROR: Render missing: AWS_BUCKET or AWS_S3_BUCKET"
  exit 1
fi
echo "OK Render: AWS_BUCKET or AWS_S3_BUCKET"

echo "Checking Netlify env vars for $NETLIFY_SITE_ID..."
netlify_required=(
  VITE_API_URL
  VITE_WS_URL
  VITE_CLERK_PUBLISHABLE_KEY
)

for key in "${netlify_required[@]}"; do
  val=$(cd "$WEB_DIR" && NETLIFY_SITE_ID="$NETLIFY_SITE_ID" NETLIFY_AUTH_TOKEN="$NETLIFY_AUTH_TOKEN" netlify env:get "$key" 2>/dev/null || true)
  if [[ -z "$val" || "$val" == *"No value set"* ]]; then
    echo "ERROR: Netlify missing: $key"
    exit 1
  fi
  echo "OK Netlify: $key"
done

echo ""
echo "Environment check passed."
