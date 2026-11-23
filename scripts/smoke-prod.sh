#!/usr/bin/env bash
set -euo pipefail

# Require explicit URLs and slugs so this script can never accidentally target another deployment.
: "${API_URL:?Set API_URL (e.g. https://hafagolf-api.onrender.com)}"
: "${WEB_URL:?Set WEB_URL (e.g. https://golf.shimizu-technology.com)}"
: "${ORG_SLUG:?Set ORG_SLUG}"
: "${TOURNAMENT_SLUG:?Set TOURNAMENT_SLUG}"
TENANT_HOST="${TENANT_HOST:-}"

check_code() {
  local url="$1"
  local expect="$2"
  local code
  if [[ -n "$TENANT_HOST" ]]; then
    code=$(curl -s -H "X-Tenant-Host: $TENANT_HOST" -o /tmp/hafagolf_smoke_body -w '%{http_code}' "$url")
  else
    code=$(curl -s -o /tmp/hafagolf_smoke_body -w '%{http_code}' "$url")
  fi
  if [[ "$code" != "$expect" ]]; then
    echo "FAIL $url -> $code (expected $expect)"
    exit 1
  fi
  echo "OK   $url -> $code"
}

echo "Running read-only smoke test against $API_URL and $WEB_URL..."

check_code "$API_URL/up" 200
check_code "$WEB_URL" 200
check_code "$WEB_URL/admin/login" 200
check_code "$API_URL/api/v1/organizations/$ORG_SLUG" 200
check_code "$API_URL/api/v1/organizations/$ORG_SLUG/tournaments" 200
check_code "$API_URL/api/v1/organizations/$ORG_SLUG/tournaments/$TOURNAMENT_SLUG" 200

TOURNAMENT_ID=$(curl -s "$API_URL/api/v1/organizations/$ORG_SLUG/tournaments/$TOURNAMENT_SLUG" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data.get('id', ''))" 2>/dev/null)
if [[ -z "$TOURNAMENT_ID" ]]; then
  echo "FAIL Failed to resolve tournament ID from $API_URL/api/v1/organizations/$ORG_SLUG/tournaments/$TOURNAMENT_SLUG"
  exit 1
fi
echo "OK   Tournament ID resolved: $TOURNAMENT_ID"

check_code "$API_URL/api/v1/tournaments/$TOURNAMENT_ID/raffle/board" 200

echo ""
echo "Smoke test passed (read-only)."
