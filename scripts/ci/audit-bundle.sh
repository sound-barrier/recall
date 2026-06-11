#!/usr/bin/env bash
# scripts/ci/audit-bundle.sh — one-shot bundle composition audit.
#
# Build the frontend, then for each generated asset in
# frontend/dist/assets/, print:
#   - the file size
#   - the dominant entry-point chunk it belongs to (best-effort
#     parse of the rollup-emitted name; the JS chunks already carry
#     a human suffix from vite.config.ts's manualChunks)
# Output is sorted by size descending so the top 10 offenders are
# always at the top.
#
# Why a script + not a Vite plugin: this is a snapshot for
# REVIEW.md, not a continuous monitor. The size budget
# gate in scripts/ci/check-bundle-size.sh runs every push; this
# audit informs human refactor decisions and runs on demand.
#
# Usage:
#   bash scripts/ci/audit-bundle.sh            # default: top 20
#   TOP_N=50 bash scripts/ci/audit-bundle.sh   # show more

set -u

TOP_N="${TOP_N:-20}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

if [[ ! -d frontend/dist/assets ]]; then
  echo "[audit] frontend/dist/assets absent — building first…"
  npm --prefix frontend run build >/dev/null
fi

echo "── Top ${TOP_N} bundle chunks by size ─────────────────────────"
printf "%10s  %s\n" "BYTES" "FILE"

# Sort by size desc, take top N. `wc -c` is portable across BSD
# (macOS) and GNU (Linux) — no `stat -f`/`stat -c` divergence to
# work around. The leading `wc` size is followed by the filename
# verbatim so awk can print both.
find frontend/dist/assets -type f \( -name '*.js' -o -name '*.css' \) -exec wc -c {} + \
  | grep -v 'total$' \
  | sort -rn \
  | head -n "$TOP_N" \
  | awk '{printf "%10d  %s\n", $1, $2}'

echo
echo "── Totals ────────────────────────────────────────────────────"
total_js=$(find frontend/dist/assets -type f -name '*.js' -exec wc -c {} + | tail -1 | awk '{print $1}')
total_css=$(find frontend/dist/assets -type f -name '*.css' -exec wc -c {} + | tail -1 | awk '{print $1}')
printf "Total JS:  %10d bytes\n" "$total_js"
printf "Total CSS: %10d bytes\n" "$total_css"

echo
echo "Quick-win candidates: any chunk > 30K is a candidate for"
echo "defineAsyncComponent extraction. Cross-reference against"
echo "App.lazy-views.test.ts before deleting an eager import."
