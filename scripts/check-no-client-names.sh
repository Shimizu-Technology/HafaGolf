#!/usr/bin/env bash
# Enforces the HafaGolf no-client-names-in-logic rule.
# Mode:
#   diff (default, PR-0a..PR-1c): checks only newly added lines in api/app/ and web/src/ against BASE_REF.
#   full (enabled in PR-2a once legacy seeded strings are removed): scans all tracked files in api/app/ and web/src/.
set -euo pipefail

MODE="${1:-diff}"
BASE_REF="${2:-origin/main}"

PATTERN='(giaa|make-a-wish|mawguam|golfforwishes|father-duenas|fd-golf|peter[[:space:]]+torres|edward[[:space:]]+a\.?p\.?[[:space:]]+muna)'

if [[ "$MODE" == "full" ]]; then
  if git grep -n -i -E "$PATTERN" -- api/app web/src ':!**/*.test.*' ':!**/*.spec.*'; then
    echo ""
    echo "ERROR: Client-specific identifier found in application logic (api/app or web/src)."
    echo "Use organization/tournament data, Brand Kit, Theme Packs, or Features.for(org, tournament) instead."
    exit 1
  fi
  echo "OK: No client-specific identifiers in api/app/ or web/src/."
  exit 0
fi

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "check-no-client-names: base ref '$BASE_REF' not found; skipping diff check."
  exit 0
fi

MATCHES=$(
  git diff -U0 "$BASE_REF"...HEAD -- api/app web/src ':!**/*.test.*' ':!**/*.spec.*' \
    | grep -E '^\+[^+]' \
    | grep -i -E "$PATTERN" || true
)

if [[ -n "$MATCHES" ]]; then
  echo "ERROR: Newly added client-specific identifier(s) detected in api/app/ or web/src/:"
  echo "$MATCHES"
  echo ""
  echo "Use organization/tournament data, Brand Kit, Theme Packs, or Features.for(org, tournament) instead."
  exit 1
fi

echo "OK: No newly added client-specific identifiers in api/app/ or web/src/ (diff vs $BASE_REF)."
