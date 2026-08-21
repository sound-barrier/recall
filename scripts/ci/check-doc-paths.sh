#!/usr/bin/env bash
#
# Verify that the agent-facing standards files describe a repo that exists.
#
# WHY THIS EXISTS
#
# The rules files spent months instructing the reader to run twenty `make`
# targets against a Makefile this project deleted, to source a
# `tool-versions.env` that was gone, and to open five `scripts/*.sh` paths that
# had each lost a directory. None of it was caught, because prose has no test
# suite and these particular files were also gitignored — invisible to CI, to
# reviewers, and to every linter.
#
# Every one of those failures was mechanically checkable. This is the check.
# It is deliberately narrow: it does not read the prose, it only asks whether
# the things the prose NAMES are real.
#
#   1. No `make <target>` invocations.       The build runner is go-task.
#   2. Every `task <name>` resolves.         Against `task --list`.
#   3. Every `scripts/…` path exists.        The one that drifted five ways.
#   4. Every `docs/*.md` reference exists.   The audience table listed five
#                                            chapters that were gone.
#
# SCOPE is the standards files themselves — the ones an agent loads and acts on.
# `docs/` chapters are deliberately excluded: `docs/dev-reference.md` uses
# `scripts/X.sh` as a legible placeholder ("syntax-check a shell script"), and a
# checker that cannot tell a placeholder from a path would train people to
# ignore it.
#
# MATCHING is backtick-anchored — `task lint`, not the English "before
# declaring any task done". A command reference in these files is always in
# code formatting; requiring that is what keeps the false-positive rate at zero,
# and a zero false-positive rate is the only reason anyone keeps a gate like
# this switched on.
#
# Usage:
#   bash scripts/ci/check-doc-paths.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

# The standards surface. A new nested CLAUDE.md belongs on this list.
DOC_FILES=()
for f in CLAUDE.md frontend/CLAUDE.md pkg/CLAUDE.md .claude/rules/*.md; do
  [[ -f "${f}" ]] && DOC_FILES+=("${f}")
done

if [[ ${#DOC_FILES[@]} -eq 0 ]]; then
  echo "::error::check-doc-paths: no standards files found — wrong cwd?" >&2
  exit 2
fi

failures=0

fail() {
  echo "  ✗ $*" >&2
  failures=$((failures + 1))
}

# ── 1. `make <target>` — the build runner is go-task ──────────────────────────
echo "==> checking for stale \`make\` invocations"
# shellcheck disable=SC2016  # the backticks are literal markdown code fences we
# are searching FOR, not command substitution waiting to be expanded.
make_hits="$(grep -rnoE '`make [a-z][a-z0-9-]*`' "${DOC_FILES[@]}" || true)"
while IFS= read -r hit; do
  [[ -n "${hit}" ]] || continue
  fail "${hit}  (this project uses go-task; there is no Makefile)"
done <<<"${make_hits}"

# ── 2. `task <name>` resolves against the real catalog ────────────────────────
echo "==> checking every documented task exists"
if command -v task >/dev/null 2>&1; then
  # --list --json, not the human table: CI runs with color on, and the ANSI
  # escapes wrapped around each name turn a column parse into "every task is
  # missing" — which is exactly how this check first failed, loudly and wrongly.
  catalog="$(task --list --json 2>/dev/null \
    | sed -n 's/.*"name": "\([^"]*\)".*/\1/p' | sort -u)"

  # An unreadable catalog is not the same as a repo with no tasks. Printing
  # "no such task" forty times because the LISTING broke would train a reader
  # to ignore this gate, so it refuses to guess.
  if [[ -z "${catalog}" ]]; then
    echo "::error::check-doc-paths: could not read the task catalog" >&2
    echo "  'task --list --json' returned nothing. Not reporting that as 40" >&2
    echo "  missing tasks — fix the catalog, then re-run." >&2
    exit 2
  fi
  # shellcheck disable=SC2016  # literal backticks, as above.
  task_hits="$(grep -rhoE '`task [a-z][a-z0-9-]*`' "${DOC_FILES[@]}" | sort -u || true)"
  while IFS= read -r hit; do
    [[ -n "${hit}" ]] || continue
    name="${hit#\`task }"
    name="${name%\`}"
    grep -qx "${name}" <<<"${catalog}" || fail "no such task: \`${name}\`"
  done <<<"${task_hits}"
else
  echo "    (skipped — go-task not on PATH)"
fi

# ── 3. Referenced scripts exist ───────────────────────────────────────────────
echo "==> checking every referenced script path resolves"
while IFS= read -r path; do
  [[ -e "${path}" ]] || fail "no such file: ${path}"
done < <(grep -rhoE '(frontend/)?scripts/[a-zA-Z0-9_/.-]+\.(sh|txt|cjs|py)' \
  "${DOC_FILES[@]}" | sort -u || true)

# ── 4. Referenced docs chapters exist ─────────────────────────────────────────
echo "==> checking every referenced docs chapter resolves"
while IFS= read -r path; do
  [[ -e "${path}" ]] || fail "no such file: ${path}"
done < <(grep -rhoE 'docs/[a-z0-9-]+\.md' "${DOC_FILES[@]}" | sort -u || true)

if [[ "${failures}" -gt 0 ]]; then
  echo >&2
  echo "::error::check-doc-paths: ${failures} reference(s) name something that does not exist." >&2
  echo "  The standards files are instructions. An instruction naming a deleted" >&2
  echo "  file is worse than no instruction — it costs the reader the time to" >&2
  echo "  find out." >&2
  exit 1
fi

echo "Doc path check: every task, script and chapter named in the standards exists."
