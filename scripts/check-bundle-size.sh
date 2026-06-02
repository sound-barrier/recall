#!/usr/bin/env bash
# scripts/check-bundle-size.sh — assert the Vite-built frontend bundle
# stays under the per-chunk + total byte budgets.
#
# Why this script exists: the budgets were previously inlined as a
# shell block in .github/workflows/ci.yml, which meant the only place
# a contributor could trip the gate was on a push to GitHub. Pulling
# the logic out lets lefthook's pre-push hook reuse the same check
# locally — same script, same budgets, same exit code. CI just builds
# first then calls this; lefthook builds + calls in one shot via
# `--build`.
#
# Budgets live in env vars so a bump is a one-line change. CI exports
# them inline next to the call; lefthook inherits from the script's
# defaults. Keeping the numbers in this script (defaults) means the
# budgets travel WITH the assertion — no risk of CI and pre-push
# drifting apart silently.
#
# Usage:
#   bash scripts/check-bundle-size.sh           # assume frontend/dist/ exists
#   bash scripts/check-bundle-size.sh --build   # run `npm run build` first
#
# Override a budget:
#   MAX_TOTAL_JS_BYTES=300000 bash scripts/check-bundle-size.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/frontend/dist/assets"

# Default budgets. Bumped over time as real features land — see git
# blame on this block for the history of "why this number now". The
# pattern: bump deliberately when a real feature needs the room;
# never bump to silence noise.
# Reset to current measurement + ~2 KB after the item-5 audit
# (TECHNICAL_DEBT.md). The previous budgets had drifted high from
# repeated "just bump it" PRs; this lower floor keeps casual growth
# honest. A real feature that needs the room should bump deliberately.
: "${MAX_INITIAL_JS_BYTES:=146000}" # 146 KB — initial JS chunk only
: "${MAX_INITIAL_CSS_BYTES:=60000}" # 60 KB  — initial CSS chunk only
: "${MAX_TOTAL_JS_BYTES:=348000}"   # 348 KB — every JS chunk combined
: "${MAX_TOTAL_CSS_BYTES:=195000}"  # 195 KB — every CSS chunk combined

if [[ "${1:-}" == "--build" ]]; then
  echo "==> building frontend (npm --prefix frontend run build)…"
  npm --prefix "${REPO_ROOT}/frontend" run build >/dev/null
fi

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "::error::frontend/dist/assets/ not found — run with --build or build first" >&2
  exit 1
fi

init_js=$(find "${DIST_DIR}" -name 'index-*.js' -exec wc -c {} + | awk 'END{print $1}')
init_css=$(find "${DIST_DIR}" -name 'index-*.css' -exec wc -c {} + | awk 'END{print $1}')
total_js=$(find "${DIST_DIR}" -name '*.js' -exec wc -c {} + | awk 'END{print $1}')
total_css=$(find "${DIST_DIR}" -name '*.css' -exec wc -c {} + | awk 'END{print $1}')

printf 'Bundle sizes: initial JS=%sB CSS=%sB  total JS=%sB CSS=%sB\n' \
  "${init_js}" "${init_css}" "${total_js}" "${total_css}"
printf 'Budgets:      initial JS=%sB CSS=%sB  total JS=%sB CSS=%sB\n' \
  "${MAX_INITIAL_JS_BYTES}" "${MAX_INITIAL_CSS_BYTES}" "${MAX_TOTAL_JS_BYTES}" "${MAX_TOTAL_CSS_BYTES}"

fail=0
if [[ "${init_js}" -gt "${MAX_INITIAL_JS_BYTES}" ]]; then
  echo "::error::Initial JS chunk ${init_js}B exceeds budget ${MAX_INITIAL_JS_BYTES}B" >&2
  fail=1
fi
if [[ "${init_css}" -gt "${MAX_INITIAL_CSS_BYTES}" ]]; then
  echo "::error::Initial CSS chunk ${init_css}B exceeds budget ${MAX_INITIAL_CSS_BYTES}B" >&2
  fail=1
fi
if [[ "${total_js}" -gt "${MAX_TOTAL_JS_BYTES}" ]]; then
  echo "::error::Total JS ${total_js}B exceeds budget ${MAX_TOTAL_JS_BYTES}B" >&2
  fail=1
fi
if [[ "${total_css}" -gt "${MAX_TOTAL_CSS_BYTES}" ]]; then
  echo "::error::Total CSS ${total_css}B exceeds budget ${MAX_TOTAL_CSS_BYTES}B" >&2
  fail=1
fi
exit "${fail}"
