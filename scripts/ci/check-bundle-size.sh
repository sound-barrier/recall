#!/usr/bin/env bash
# scripts/ci/check-bundle-size.sh — assert the Vite-built frontend bundle
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
#   bash scripts/ci/check-bundle-size.sh           # assume frontend/dist/ exists
#   bash scripts/ci/check-bundle-size.sh --build   # run `npm run build` first
#
# Override a budget:
#   MAX_TOTAL_JS_BYTES=300000 bash scripts/ci/check-bundle-size.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="${REPO_ROOT}/frontend/dist/assets"

# Default budgets. Per-PR bump rationale lives in
# scripts/ci/bundle-size-budget-history.md — append a row there when
# you change a number here. Bump deliberately; don't lift caps to
# silence noise.
: "${MAX_INITIAL_JS_BYTES:=162000}"
# 2026-07: 67000 → 68000 — the Phase-5 sample-size caveat chip
# (.bd-low-n in components.css) landed the initial CSS 192B over the
# old point. ~1KB headroom, same ratchet spirit: bump deliberately
# with a rationale, never to absorb accidental bloat.
: "${MAX_INITIAL_CSS_BYTES:=69000}"
# The Matches "Trends" charts pull in ECharts (tree-shaken to line + bar
# charts, grid/tooltip/legend/markline/data-zoom/brush components, canvas
# renderer). It rides in its own lazily-loaded chunk (TrendChart-*.js),
# loaded only when the user expands the Trends section, so INITIAL JS is
# unaffected — but it counts toward the TOTAL.
# 2026-07: +14KB headroom over the prior 1256000 ratchet point — the
# audit Phase-3 refactors (narrow clause registry, shared band header,
# per-store boot loaders) net-added ~0.3KB of lazy-chunk JS and landed
# exactly 318B over. The ratchet stays tight: bump deliberately with a
# rationale here, never to absorb accidental bloat.
# 2026-07: 1270000 → 1320000 — echarts 5.6 → 6.1 (with vue-echarts 8),
# the dependabot major that fixes CVE-2026-45249, adds ~44KB to the
# lazy TrendChart chunk (total-only; initial JS untouched). Security
# upgrade, not bloat absorption.
# 2026-07: 1320000 → 1360000 — the "Best times to play" heatmap card
# registers two more tree-shaken ECharts pieces (HeatmapChart +
# VisualMapComponent) in the lazy TrendChart chunk, ~37.5KB total-only
# (initial JS untouched). The approved flagship 6.1 chart, not bloat.
# 2026-07: 1385000 → 1402000 — the Season Comparison tab (SeasonCompareView +
# match-compare-helpers + match-compare-aggregate: per-role/hero/mode/queue
# breakdowns, sectioned table) adds a new lazy view chunk, ~13.5KB total-only.
# It's a defineAsyncComponent, so initial JS is untouched; a whole new feature
# tab with a rich metric set, not bloat absorption.
# 2026-07: 1402000 → 1424000 — the Compare tab's Form mode (FormCompareView +
# form slices/verdict + drill-through), ~16KB in the same lazy compare chunk
# (initial JS untouched). A second full comparison mode, not bloat.
# 2026-07: 1424000 → 1430000 — hero-swap discipline pair (Heroes per match +
# Hero pool widgets + match-hero-pool-helpers + Compare rows), ~1.3KB in the
# MatchesView/compare chunks (initial JS untouched). New feature.
# 2026-07: 1430000 -> 1465000 - the Elo Calculator tab (lazy chunk: view +
# projection math + chart options), ~28KB. New feature.
# 2026-07: 1465000 -> 1475000 - the Hero Pool band rebuild (3-mode toggle,
# per-role pools, pool-membership narrow), ~5KB in the MatchesView chunk. New feature.
: "${MAX_TOTAL_JS_BYTES:=1475000}"
# 2026-07: 322000 → 325000 — the Season Comparison view's scoped styles
# (the A/B/Δ table, scope toggle, controls) add ~2KB. New feature.
# 2026-07: 325000 → 332000 — Form-mode scoped styles (verdict card, preset
# chips, pairing controls, sparklines), ~5KB. New feature.
# 2026-07: 332000 -> 335000 - the Hero Pool band's scoped styles (three-column
# layout, bars, gear), ~1KB. New feature.
# 2026-07: 335000 -> 345000 - Elo Calculator scoped styles (form, cards,
# evidence grid, chart frame), ~5.5KB. New feature.
: "${MAX_TOTAL_CSS_BYTES:=345000}"

if [[ "${1:-}" == "--build" ]]; then
  # Build into a PID-suffixed staging dir and measure THERE — never
  # frontend/dist. lefthook runs pre-push hooks in parallel, and
  # vite's empty-at-start on the real dist raced any concurrent
  # lint-go-full / coverage hook compiling
  # `//go:embed all:frontend/dist` (the same class the smoke hook was
  # cured of by its isolated worktree). CI calls this script WITHOUT
  # --build and keeps reading the real dist it built one step earlier.
  STAGE_DIR="/tmp/recall-bundle-stage-$$"
  trap 'rm -rf "$STAGE_DIR"' EXIT
  echo "==> building frontend into ${STAGE_DIR} (staged)…"
  npm --prefix "${REPO_ROOT}/frontend" run build -- --outDir "$STAGE_DIR" --emptyOutDir >/dev/null
  DIST_DIR="${STAGE_DIR}/assets"
fi

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "::error::frontend/dist/assets/ not found — run with --build or build first" >&2
  exit 1
fi

init_js=$(find "${DIST_DIR}" -name 'index-*.js' -exec wc -c {} + | awk 'END{print $1}')
init_css=$(find "${DIST_DIR}" -name 'index-*.css' -exec wc -c {} + | awk 'END{print $1}')
total_js=$(find "${DIST_DIR}" -name '*.js' -exec wc -c {} + | awk 'END{print $1}')
total_css=$(find "${DIST_DIR}" -name '*.css' -exec wc -c {} + | awk 'END{print $1}')
# Default to 0 when a glob matches nothing so the integer comparisons
# below don't choke on an empty string ("[[ '' -gt N ]]" is a fatal
# bash error). DIST_DIR is always populated post-build in CI; this is a
# guard against the empty edge, not a silent pass.
: "${init_js:=0}"
: "${init_css:=0}"
: "${total_js:=0}"
: "${total_css:=0}"

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
