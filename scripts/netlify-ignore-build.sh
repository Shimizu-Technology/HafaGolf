#!/usr/bin/env bash
# Netlify build ignore script for HafaGolf.
# Exit 0 = skip build; Exit 1 = proceed with build.
# Safe default: if git history or commit range is missing/uncertain, allow the build (exit 1).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "netlify-ignore-build: git root unavailable — allowing build"
  exit 1
fi

cd "$REPO_ROOT"

BASE_REF="${CACHED_COMMIT_REF:-}"
HEAD_REF="${COMMIT_REF:-HEAD}"

if [[ -z "$BASE_REF" ]]; then
  echo "netlify-ignore-build: no CACHED_COMMIT_REF — allowing build"
  exit 1
fi

if ! git cat-file -e "${BASE_REF}^{commit}" 2>/dev/null || ! git cat-file -e "${HEAD_REF}^{commit}" 2>/dev/null; then
  echo "netlify-ignore-build: commit range unavailable (${BASE_REF}..${HEAD_REF}) — allowing build"
  exit 1
fi

WATCH_PATHS=(
  "web/"
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "netlify.toml"
  "scripts/netlify-ignore-build.sh"
)

if git diff --quiet "$BASE_REF" "$HEAD_REF" -- "${WATCH_PATHS[@]}"; then
  echo "netlify-ignore-build: no frontend or shared build input changes between ${BASE_REF:0:7} and ${HEAD_REF:0:7} — skipping build"
  exit 0
fi

echo "netlify-ignore-build: frontend or shared build inputs changed — proceeding with build"
exit 1
