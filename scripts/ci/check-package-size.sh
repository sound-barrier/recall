#!/usr/bin/env bash
# scripts/ci/check-package-size.sh — assert that no Go package and no frontend
# source directory holds more files than its declared budget.
#
# Why this script exists: "size a grouping by responsibility, not file count" is
# the right rule, and it loses to entropy anyway. pkg/app reached 54 files one
# obviously-fine file at a time, and every one of those files was individually
# defensible. Prose ceilings do not help — this repo carried a documented
# "~20–25 files" frontend ceiling in two CLAUDE.md files while six directories
# sat above it, because nothing ever asserted it, and TECHNICAL_DEBT.md §3
# recorded per-file growth triggers that three files then quietly passed. So
# cohesion stays the rule a human applies, and this is the mechanical backstop
# underneath it: one number per grouping, declared in package-size-budgets.txt
# next to the reason it is that number, asserted on every push. Modeled on
# check-bundle-size.sh (budgets that travel WITH the assertion, bumped
# deliberately with a written why) and deadcode-allow.txt (one entry, one
# reason, fail loudly when the list is empty).
#
# THE METRIC — deliberately narrow, because a metric that is easy to game or
# noisy is worse than no metric at all:
#
#   * FILES, never lines. File length already has its own rule (~500 lines,
#     best-effort). A LOC budget would double-count that rule AND reward the
#     wrong move: splitting one 600-line file into two 300-line files to duck a
#     budget produces exactly the tiny-file sprawl this project does not want. A
#     file count moves only when someone deliberately creates a file, and the
#     only way to game it downward is to MERGE files — which the file-length
#     rule catches.
#
#   * PER DIRECTORY, never recursive. A Go package IS a directory, and pkg/db
#     and pkg/db/dbtest are two packages with two exported APIs. On the frontend
#     the sanctioned fix for a bloated folder is subfolders, so a recursive
#     count would make the remedy a no-op and the gate would fight the very
#     thing it exists to prompt. The pressure against "just make subfolders" is
#     review plus the CLAUDE.md rule, not arithmetic: N new directories in a
#     diff is a visible thing to question, and a two-file package carved out to
#     duck a budget is a worse outcome than the file that tripped it.
#
#   * Go directories count non-test .go files only. Embedded assets are NOT
#     counted: pkg/db/migrations/ is an append-only ledger that grows forever by
#     design, and schema.sql / heroes.yaml are data the package ships, not
#     concerns a reader holds in their head.
#
#   * Frontend directories count every tracked file EXCEPT *.test.ts. A unit-test
#     sibling is a projection of the file beside it — same name, same concern,
#     always adjacent — so counting both double-counts one unit of cognition. A
#     tests/e2e/*.spec.ts has no source sibling: it IS the unit, so it counts.
#     (This is why frontend/src reads 14 here and 23 in `ls`.)
#
#   * Build-tag and GOOS pairs count as the two files they are. app_wails.go and
#     app_server.go are two files a maintainer must open and keep in agreement,
#     and scripts/ci/deadcode-allow.txt is a monument to how often that pair
#     drifts. Collapsing a pair to one would also invite spelling a single
#     concern as N tag-gated files to duck the budget.
#
#   * Generated trees are exempted in the BUDGET FILE (`exempt`), not here, so an
#     exemption carries a reason like every other entry. The *_test.go /
#     *.test.ts / *-snapshots/ exclusions live HERE because they define the
#     metric rather than state a policy.
#
#   * `git ls-files`, not `find`: the gate measures what is committed or staged,
#     so it reads identically on a clean CI checkout and on a dirty local tree
#     carrying node_modules/, dist/, coverage/ and data/. Corollary — a brand-new
#     file only counts once it is `git add`ed, the same caveat lefthook's
#     gen-types-drift hook carries.
#
# A directory not named in the budget file gets DEFAULT_MAX_FILES. That is the
# standing decision — "no grouping passes 12 files without a written reason" —
# not an escape hatch. Registration is earned by size, which keeps the budget
# file short and every line in it load-bearing; erroring on an unregistered
# directory would instead tax the cheap correct thing (a new three-file feature
# folder). The default cannot be dodged by DELETING an entry: an over-budget
# directory whose entry is removed falls back to 12 and fails harder.
#
# There is deliberately NO minimum. This project does not want tiny packages
# either, but pkg/profiles (2 files), cmd/seed-dev (1) and src/types (1) are all
# correct, so a mechanical floor would only manufacture false positives. "Do not
# carve out a two-file package to duck a budget" is enforced by the CLAUDE.md
# rule and by review.
#
# Usage:
#   bash scripts/ci/check-package-size.sh          # the gate
#   bash scripts/ci/check-package-size.sh --list   # every dir, count, budget
#
# Override the default (one-off experiments only — a real change belongs in the
# budget file):
#   DEFAULT_MAX_FILES=15 bash scripts/ci/check-package-size.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUDGET_FILE="${REPO_ROOT}/scripts/ci/package-size-budgets.txt"
HISTORY_FILE="scripts/ci/package-size-budget-history.md"

: "${DEFAULT_MAX_FILES:=12}"

MODE=gate
if [[ "${1:-}" == "--list" ]]; then
  MODE=list
elif [[ -n "${1:-}" ]]; then
  echo "usage: $(basename "$0") [--list]" >&2
  exit 2
fi

if [[ ! -f "${BUDGET_FILE}" ]]; then
  echo "::error::budget file not found at ${BUDGET_FILE}" >&2
  exit 1
fi

# An empty budget file would silently pass everything at the default, which is
# the trap deadcode-check.sh guards its allow-list against.
if ! grep -qE '^[^#[:space:]]' "${BUDGET_FILE}"; then
  echo "::error::${BUDGET_FILE} has no active entries" >&2
  exit 1
fi

# One awk does the filtering AND the counting. A grep chain would be more
# readable and would also be a landmine: under `set -o pipefail` a `grep -v`
# that filters away every line exits 1 and kills the script with no clue why.
counts="$(
  git -C "${REPO_ROOT}" ls-files -- '*.go' 'frontend/src' 'frontend/tests' \
    | awk -F/ '
        /_test\.go$/   { next }
        /\.test\.ts$/  { next }
        /-snapshots\// { next }
        {
          if (NF == 1) {
            d = "."
          } else {
            d = $1
            for (i = 2; i < NF; i++) d = d "/" $i
          }
          n[d]++
        }
        END { for (d in n) printf "%s %d\n", d, n[d] }
      ' \
    | sort
)"

if [[ -z "${counts}" ]]; then
  echo "::error::no source files found under ${REPO_ROOT} — not a git checkout?" >&2
  exit 1
fi

printf '%s\n' "${counts}" | awk \
  -v budget_file="${BUDGET_FILE}" \
  -v history_file="${HISTORY_FILE}" \
  -v default_max="${DEFAULT_MAX_FILES}" \
  -v mode="${MODE}" \
  '
  function err(msg) { printf "::error::%s\n", msg > "/dev/stderr"; fail = 1 }
  function warn(msg) { printf "::warning::%s\n", msg > "/dev/stderr" }

  # ── pass 1: the budget file ───────────────────────────────────────────
  NR == FNR {
    raw = $0
    sub(/[[:space:]]+$/, "", raw)
    if (raw ~ /^[[:space:]]*#/) { commented = 1; next }
    if (raw ~ /^[[:space:]]*$/) { commented = 0; next }

    sub(/[[:space:]]*#.*$/, "", raw)
    nf = split(raw, f, /[[:space:]]+/)

    if (!commented) {
      err(budget_file ":" FNR ": entry \"" f[1] "\" has no reason comment directly above it" \
          " — say WHY the number is that number, on the lines immediately above, no blank line between")
    }
    commented = 0

    if (nf < 2 || nf > 3) {
      err(budget_file ":" FNR ": expected \"<dir> <budget|exempt> [<waiver>]\", got \"" raw "\"")
      next
    }
    path = f[1]
    if (path in budget || path in exempt) {
      err(budget_file ":" FNR ": duplicate entry for " path)
      next
    }
    if (f[2] == "exempt") {
      if (nf != 2) { err(budget_file ":" FNR ": \"exempt\" takes no waiver column"); next }
      exempt[path] = 1
      next
    }
    if (f[2] !~ /^[0-9]+$/) {
      err(budget_file ":" FNR ": budget must be an integer or \"exempt\", got \"" f[2] "\"")
      next
    }
    budget[path] = f[2] + 0
    if (nf == 3) {
      if (f[3] !~ /^[0-9]+$/) {
        err(budget_file ":" FNR ": waiver must be an integer, got \"" f[3] "\"")
        next
      }
      waiver[path] = f[3] + 0
      if (waiver[path] <= budget[path]) {
        err(budget_file ":" FNR ": waiver " f[3] " must EXCEED the budget " f[2] \
            " — the waiver records debt above the target, it is not the target")
      }
    }
    next
  }

  # ── pass 2: the measured directories ─────────────────────────────────
  {
    dir = $1
    n = $2 + 0

    skip = 0
    for (p in exempt) {
      if (dir == p || index(dir, p "/") == 1) { exempt_used[p] = 1; skip = 1; break }
    }
    if (skip) next

    if (dir in budget) {
      seen[dir] = 1
      max = budget[dir]
      src = "declared"
    } else {
      max = default_max
      src = "default"
    }
    cap = (dir in waiver) ? waiver[dir] : max

    if (mode == "list") {
      label = src
      if (dir in waiver) label = label ", waived to " cap
      printf "%-46s %4d / %-4d  (%s)\n", dir, n, max, label
      next
    }

    if (n > cap) {
      err(dir " holds " n " files, budget " max \
          ((dir in waiver) ? " (temporarily waived to " cap ")" : "") \
          " — declared in " budget_file)
      offenders = 1
      next
    }
    if (dir in waiver) {
      if (n <= max) {
        err(dir " is at " n " files, at or under its target budget of " max \
            " — the temporary waiver of " cap " is PAID. Delete the third column in " \
            budget_file " (delete-when-paid, not strikethrough-when-paid).")
        next
      }
      warn(dir " holds " n " files against a target budget of " max \
           " (temporarily waived to " cap ") — over budget on purpose; the split is owed")
    }
    # Symmetric to the paid-waiver check above. An entry that grants MORE than
    # the default while the directory sits UNDER the default asserts nothing:
    # deleting it would make the limit STRICTER. That is how a split leaves
    # slack behind — the folder is emptied, the pre-split budget stays, and the
    # next dozen files land ungated on the folder we just cleaned out.
    # Registration is earned by size; this is the mechanical form of that rule.
    # Registering BELOW the default to be deliberately stricter stays legal —
    # only a budget above the default is checked.
    if (dir in budget && !(dir in waiver) && max > default_max && n < default_max) {
      err(dir " is at " n " files with a declared budget of " max ", which is looser" \
          " than the default " default_max " it would fall back to — the entry grants" \
          " growth room instead of limiting it. Delete it (registration is earned by" \
          " size), or lower the budget to a number this directory actually needs.")
    }
  }

  END {
    for (p in budget)
      if (!(p in seen))
        err(budget_file ": entry \"" p "\" names a directory with no counted source files" \
            " — delete the stale entry, or fix the path")
    for (p in exempt)
      if (!(p in exempt_used))
        err(budget_file ": exempt entry \"" p "\" matched nothing — delete it")

    if (offenders) {
      print ""                                                                         > "/dev/stderr"
      print "A directory is over its file budget. There are exactly TWO legitimate"     > "/dev/stderr"
      print "responses. Pick one, and say which in the PR:"                             > "/dev/stderr"
      print ""                                                                         > "/dev/stderr"
      print "  1. SPLIT — the grouping carries more than one reason to change."         > "/dev/stderr"
      print "     Go:  pull pure logic into a leaf package the shell delegates to."     > "/dev/stderr"
      print "          pkg/match, pkg/correlate and pkg/aggregate came out of pkg/app"  > "/dev/stderr"
      print "          exactly this way; the *App shell kept the wiring."               > "/dev/stderr"
      print "     Vue: give the feature its own subfolder — components/<feature>/,"     > "/dev/stderr"
      print "          composables/<feature>/, shared/ for cross-feature pieces."       > "/dev/stderr"
      print "     COHESION IS THE TEST, NOT THE NUMBER. Do not carve out a two-file"    > "/dev/stderr"
      print "     package to get under the line — that is a worse outcome than the"     > "/dev/stderr"
      print "     file that tripped the gate."                                          > "/dev/stderr"
      print ""                                                                         > "/dev/stderr"
      print "  2. BUMP — the new file is the same responsibility spelled one concern"   > "/dev/stderr"
      print "     wider (a new migration, a new screenshot type, a new endpoint on an"  > "/dev/stderr"
      print "     existing surface). Raise the number in:"                              > "/dev/stderr"
      print "       " budget_file                                                       > "/dev/stderr"
      print "     rewrite the WHY in the comment block directly above the entry, and"   > "/dev/stderr"
      print "     append a row to:"                                                     > "/dev/stderr"
      print "       " history_file                                                      > "/dev/stderr"
      print "     \"The gate was in the way\" is not a reason."                         > "/dev/stderr"
      print ""                                                                         > "/dev/stderr"
      print "  Not sure which? Run: bash scripts/ci/check-package-size.sh --list"       > "/dev/stderr"
    }
    exit (fail ? 1 : 0)
  }
  ' "${BUDGET_FILE}" -
