#!/usr/bin/env bash
# scripts/ci/gobco-report.sh — condition (branch) coverage for the Go packages,
# via rillig/gobco. INFORMATIONAL: it prints a report and writes JSON, and it
# never gates. `task cover-go`'s GO_COVERAGE_MIN remains the only Go coverage
# gate.
#
# What this measures that `go test -cover` cannot: Go ships STATEMENT coverage,
# so an `if a && b` counts as covered the moment the line runs. gobco rewrites
# the package and instruments every boolean expression, then reports the
# conditions never observed BOTH true and false — "condition `n == 6` was 12
# times true but never false". Each such line is one missing test case, which is
# why this is a worklist rather than a percentage to chase.
#
# It replaces the basic-block approximation `cover-go` used to print in awk,
# whose own comment said "Go has no native branch coverage". Basic-block
# coverage answers "was this block entered"; gobco answers "was this condition
# ever false", which is strictly stronger. Publishing both would put two
# disagreeing numbers under the same word.
#
# Why a script rather than three Taskfile lines — gobco has four sharp edges
# here, and each needs its reason recorded next to the workaround:
#
#   1. GOBCO COPIES THE WHOLE MODULE, ONCE PER PACKAGE. It resolves the module
#      root and walks it into $TMPDIR. From a dev checkout carrying node_modules,
#      dist/, coverage/ and the dev SQLite DB that is gigabytes of I/O per
#      package, times every package. So this runs inside an isolated
#      `git worktree` of HEAD: tracked files only, no build output, no dev data.
#      CI's checkout is already clean, but the worktree runs there too so local
#      and CI produce the same number from the same code path.
#
#   2. NEVER PASS -race. gobco's injected counters are plain increments with no
#      synchronization, so any package with t.Parallel() or a goroutine under
#      test reports a data race and the run dies. The corollary belongs in the
#      report, not just this comment: concurrent increments are lossy, so a
#      "never true" verdict in a concurrent package may be a lost increment.
#      Confirm before writing a test for it. `-race` lives in `task test` and
#      lefthook's unit-go; this is a report.
#
#   3. -short, AND SAY SO. Parity with the unit gate, and it keeps pkg/parser
#      from OCRing the golden corpus. The reported number IS the short-mode
#      number, and the footer says so, or it is a lie.
#
#   4. DEFAULT BUILD TAGS ONLY. gobco instruments one package under whatever
#      tags `go test` resolves. Default = the DESKTOP build: pkg/app/app_wails.go
#      is measured and app_server.go is not, and pkg/cmd's !serveronly test files
#      DO compile in (which is why default beats -tags=serveronly here — the
#      serveronly view badly understates pkg/cmd). GOOS-gated files are
#      unmeasured on this runner, the same caveat statement coverage carries.
#
# Also: gobco takes exactly ONE package per invocation, so this loops. And it
# LOADS its -stats file before writing it and panics if the counter count has
# changed, so every package gets its own file and OUT_DIR is wiped first.
#
#   5. IT IGNORES BUILD TAGS, and there is no flag to change that. gobco parses
#      and type-checks every .go file in the package itself, before `go test`
#      ever runs, so a package carrying a build-tag TWIN PAIR is a hard panic:
#        pkg/app   — app_wails.go and app_server.go both declare emitParseProgress
#        pkg/cmd   — a test names an export that exists only under !serveronly
#        pkg/probe — probe_windows.go imports a Windows-only registry package
#        pkg/db    — a test names a symbol from an internal export_test.go
#      Measured, not guessed: gobco reads 8 of this module's 20 test-bearing
#      packages. The twelve it cannot read are the large ones, which is why
#      `task cover-go` still prints basic-block coverage for every package —
#      deleting that in favor of this was a trade of full coverage for 40%.
#      Those are the two largest packages in the module, so a report that
#      quietly omitted them would be worse than no report — it would look
#      complete. They are listed in UNANALYZABLE below and named in the output,
#      so the gap is stated rather than hidden. Do not "fix" this by deleting a
#      twin: the pair is what lets the desktop and server builds diverge.
#
# Usage:
#   bash scripts/ci/gobco-report.sh                 # every package with tests
#   bash scripts/ci/gobco-report.sh ./pkg/match     # one package
#   OUT_DIR=/tmp/x bash scripts/ci/gobco-report.sh  # relocate the JSON

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-${REPO_ROOT}/coverage/go/branch}"
WORKTREE="${WORKTREE:-/tmp/recall-gobco-$$}"
skipped=""

if ! command -v gobco >/dev/null 2>&1; then
  echo "::error::gobco not installed — run 'mise install' (pinned in mise.toml [tools])" >&2
  exit 1
fi

cd "${REPO_ROOT}"

# Packages that HAVE tests, derived rather than hand-listed so the set cannot go
# stale. This drops the root package (no tests, and its //go:embed of
# frontend/dist would not resolve in a worktree anyway), both cmd/ binaries, and
# pkg/db/dbtest — all test-less by nature. node_modules is filtered for the same
# reason deadcode-check.sh filters it.
if [[ $# -gt 0 ]]; then
  pkgs="$*"
else
  pkgs="$(
    go list -f '{{if or .TestGoFiles .XTestGoFiles}}{{.ImportPath}}{{end}}' ./... \
      | grep -v node_modules
  )"
fi

# Packages gobco cannot analyze, with the reason. Each is EXCLUDED from the
# loop and NAMED in the output — an unmeasured package must never read as a
# measured one. Remove an entry only when gobco learns build tags.
# Measured empirically by running gobco against every package, not guessed.
UNANALYZABLE="recall/pkg/aggregate recall/pkg/app recall/pkg/applog recall/pkg/bundle \
  recall/pkg/cmd recall/pkg/coach recall/pkg/db recall/pkg/fixtures \
  recall/pkg/gamedata recall/pkg/parser recall/pkg/probe recall/pkg/seed"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

# RECALL_DATA_DIR points at the repo's data/ dir via mise [env]. Every test that
# needs it already redirects to a t.TempDir(), but a report is not worth any
# chance of touching the dev database — override it for the run.
GOBCO_DATA_DIR="$(mktemp -d)"

cleanup() {
  cd "${REPO_ROOT}"
  git worktree remove --force "${WORKTREE}" 2>/dev/null || true
  rm -rf "${GOBCO_DATA_DIR}"
}
trap cleanup EXIT

git worktree remove --force "${WORKTREE}" 2>/dev/null || true
git worktree add --force --detach "${WORKTREE}" HEAD >/dev/null

echo "[ recall ] gobco · condition coverage · -short · default (desktop) build tags"
echo "[ recall ] worktree: ${WORKTREE}  ·  stats: ${OUT_DIR}"

for pkg in ${pkgs}; do
  case " ${UNANALYZABLE} " in
    *" ${pkg} "*)
      echo "[ recall ] ── ${pkg}  SKIPPED — gobco ignores build tags (see the header)"
      skipped="${skipped} ${pkg}"
      continue
      ;;
  esac
  # Accept either form: `go list` yields `recall/pkg/match`, an explicit
  # argument is `./pkg/match`. Normalize both to a bare `pkg/match` before
  # deriving the slug — a leading "./" would otherwise produce a DOTFILE stats
  # name that the summary glob silently skips.
  rel="${pkg#recall/}"
  rel="./${rel#./}"
  slug="${rel#./}"
  slug="${slug//\//_}"
  echo "[ recall ] ── ${pkg}"
  # -vet=off: `go test` would vet machine-generated instrumented source for no
  # benefit — golangci-lint already vetted the real thing in `task lint`.
  (
    cd "${WORKTREE}"
    RECALL_DATA_DIR="${GOBCO_DATA_DIR}" \
      gobco -branch -stats "${OUT_DIR}/${slug}.json" \
      -test=-short -test=-vet=off "${rel}"
  ) || echo "::warning::gobco failed for ${pkg} — see output above (a report, not a gate)"
done

echo
echo "[ recall ] Condition coverage (arms observed / arms present):"
for f in "${OUT_DIR}"/*.json; do
  [[ -e "${f}" ]] || continue
  jq -r --arg pkg "$(basename "${f}" .json | tr '_' '/')" '
    (length * 2) as $total
    | ([.[] | (if .TrueCount  > 0 then 1 else 0 end)
             + (if .FalseCount > 0 then 1 else 0 end)] | add // 0) as $hit
    | "\($pkg)\t\($hit)\t\($total)"
  ' "${f}"
done | sort | awk -F'\t' '
  {
    th += $2; tt += $3
    printf "  %-26s %5d / %-5d  %5.1f%%\n", $1, $2, $3, ($3 ? 100 * $2 / $3 : 0)
  }
  END { if (tt) printf "  %-26s %5d / %-5d  %5.1f%%\n", "TOTAL", th, tt, 100 * th / tt }'

echo
if [[ -n "${skipped:-}" ]]; then
  echo "[ recall ] !  NOT MEASURED (gobco ignores build tags):${skipped}"
  echo "[ recall ] !  Those are the two largest packages. This report covers the rest."
fi
echo "[ recall ] i  Informational. The Go coverage GATE is GO_COVERAGE_MIN in Taskfile.yml."
echo "[ recall ] i  Short mode, default (desktop) build tags, no -race. Counters are"
echo "[ recall ] i  unsynchronized, so a 'never taken' verdict in a concurrent package"
echo "[ recall ] i  can be a lost increment — confirm before writing a test for it."
