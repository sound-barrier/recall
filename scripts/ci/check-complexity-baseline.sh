#!/usr/bin/env bash
# Diff the current Go complexity sweep against the checked-in
# baseline. REPORT ONLY — prints a summary table, never fails.
#
# Modes:
#   capture            — print the current top-20 (paste into
#                        docs/baselines/complexity-baseline.txt).
#   (default / "diff") — compare current vs baseline; print
#                        functions that climbed by ≥ 5 or newly
#                        cracked the top-20.
#
# Same threshold logic as scripts/ci/check-complexity.sh; we re-use its
# gocyclo invocation but constrain to Go (the frontend numbers churn
# too much per-PR via lambda churn — Go is the stable target). Test
# files are excluded so table-driven matrices don't dominate.

set -u

THRESHOLD=10
JUMP=5
TOP_N=20
BASELINE="docs/baselines/complexity-baseline.txt"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# shellcheck disable=SC1091
. ./tool-versions.env

GOCYCLO="$(command -v gocyclo || true)"
if [[ -z "$GOCYCLO" ]]; then
  if ! command -v go >/dev/null; then
    echo "[baseline] go toolchain absent — skipping."
    exit 0
  fi
  echo "[baseline] bootstrapping gocyclo ${GOCYCLO_VERSION}…"
  go install "github.com/fzipp/gocyclo/cmd/gocyclo@${GOCYCLO_VERSION}"
  GOCYCLO="$(go env GOPATH)/bin/gocyclo"
fi

# Capture the current top-N. Filter out:
#   - flatted (the stray frontend/node_modules embed sentinel)
#   - any _test.go function
current() {
  "$GOCYCLO" -over "$THRESHOLD" . 2>/dev/null \
    | grep -v "frontend/node_modules" \
    | grep -v "_test\\.go:" \
    | head -n "$TOP_N"
}

mode="${1:-diff}"

if [[ "$mode" == "capture" ]]; then
  current
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "[baseline] $BASELINE missing — run 'bash scripts/ci/check-complexity-baseline.sh capture > $BASELINE' first."
  exit 0
fi

# Build a name → score map from the baseline.
declare -A baseline_score
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  # Field layout: SCORE PKG FUNCNAME FILE:LINE
  score=$(awk '{print $1}' <<<"$line")
  funcname=$(awk '{print $3}' <<<"$line")
  baseline_score["$funcname"]=$score
done <"$BASELINE"

# Walk current top-N. For each: jumped by JUMP? new entry? Print one line.
declare -i jumps=0
declare -i newcomers=0
declare -i unchanged=0

while IFS= read -r line; do
  score=$(awk '{print $1}' <<<"$line")
  funcname=$(awk '{print $3}' <<<"$line")
  loc=$(awk '{print $4}' <<<"$line")

  prev="${baseline_score[$funcname]:-}"
  if [[ -z "$prev" ]]; then
    printf "🆕 %3d  %-40s  %s\n" "$score" "$funcname" "$loc"
    newcomers=$((newcomers + 1))
    continue
  fi
  delta=$((score - prev))
  if ((delta >= JUMP)); then
    printf "📈 %3d (+%d)  %-37s  %s\n" "$score" "$delta" "$funcname" "$loc"
    jumps=$((jumps + 1))
  elif ((delta <= -JUMP)); then
    printf "📉 %3d (%d)  %-38s  %s\n" "$score" "$delta" "$funcname" "$loc"
    unchanged=$((unchanged + 1))
  fi
done < <(current)

echo
echo "[baseline] $jumps jumps · $newcomers newcomers · top-${TOP_N} report only."
exit 0
