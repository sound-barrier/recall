# shellcheck shell=bash
# Shared helpers for the release smoke suite, sourced by ../smoke.sh.
#
# Not executable on its own (leading underscore = "library, not a
# command"). The cases in ../cases/ call these; the counters live here so
# the runner's summary sees every case file's results.

PASS=0
FAIL=0
SKIP=0
FAILURES=()

# ── Helpers ──────────────────────────────────────────────────────────

# ok / not_ok / skip print one line each. The summary at the end is the
# canonical success/failure signal for CI.
ok() {
  printf '  \033[32mPASS\033[0m  %s\n' "$1"
  PASS=$((PASS + 1))
}

not_ok() {
  printf '  \033[31mFAIL\033[0m  %s\n' "$1"
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
}

skip() {
  printf '  \033[33mSKIP\033[0m  %s (%s)\n' "$1" "$2"
  SKIP=$((SKIP + 1))
}

# Run `cmd...` in a fresh per-test temp dir; restore cwd + clean up
# afterward. NOT a subshell — the PASS/FAIL/SKIP counter vars need to
# survive back into the parent scope.
run_in_temp() {
  local tmpdir prev_dir rc=0
  tmpdir=$(mktemp -d)
  prev_dir=$(pwd)
  cd "$tmpdir" || return
  "$@" || rc=$?
  cd "$prev_dir" || return
  rm -rf "$tmpdir"
  return "$rc"
}

# run_case <label> <want exit> <want output> <command...>
# Passes when the command exits <want exit> and its combined output contains
# <want output>. The text pins WHICH check refused: a script can also exit 1
# because `set -e` tripped on something unrelated to the case.
run_case() {
  local label=$1 want_rc=$2 want_output=$3 output rc=0
  shift 3
  output=$("$@" 2>&1) || rc=$?
  if [ "$rc" -ne "$want_rc" ]; then
    not_ok "${label} (exit ${rc}, want ${want_rc})"
  elif [[ $output != *"$want_output"* ]]; then
    not_ok "${label} (output lacks: ${want_output})"
  else
    ok "$label"
    return 0
  fi
  printf '%s\n' "$output" | sed 's/^/        | /'
}

# report_results prints the summary and exits 1 when any case failed.
report_results() {
  printf '\n──────────────────────────────────────────\n'
  printf 'PASS: %d   FAIL: %d   SKIP: %d\n' "$PASS" "$FAIL" "$SKIP"

  if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed:\n'
    local f
    for f in "${FAILURES[@]}"; do
      printf '  - %s\n' "$f"
    done
    exit 1
  fi
}

# ── Scratch release repositories ─────────────────────────────────────

# The maintainer's git config must not reach the scratch repositories:
# commit signing, a global hooksPath or an init template would make a case
# fail, or pass, for a reason unrelated to the script under test.
isolate_git() {
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  export GIT_AUTHOR_NAME=smoke GIT_AUTHOR_EMAIL=smoke@example.invalid
  export GIT_COMMITTER_NAME=smoke GIT_COMMITTER_EMAIL=smoke@example.invalid
}

# commit_release <version> <subject>: the shape of release-please's merge
# commit, a manifest reading <version> under <subject>.
commit_release() {
  printf '{".": "%s"}\n' "$1" >.release-please-manifest.json
  git add .release-please-manifest.json
  git commit -q -m "$2"
}

# make_release_repo <version> <subject>: a bare ./origin.git and a clone in
# ./work whose main holds a base commit and then commit_release's commit,
# pushed and fetched. Leaves the shell in ./work.
make_release_repo() {
  git init -q --bare -b main origin.git
  git init -q -b main work
  cd work || return
  git remote add origin ../origin.git
  printf 'base\n' >README.md
  git add README.md
  git commit -q -m 'feat: base'
  commit_release "$1" "$2"
  git push -q origin main
  git fetch -q origin
}

# ── gh stub + expectations ───────────────────────────────────────────

# install_gh_stub: writes ./stub/gh and points STUB_DIR at ./stub. with_gh_stub
# puts it first on PATH. `gh api repos/*/commits/*/pulls` prints
# $STUB_DIR/pulls.json, or $STUB_DIR/pulls-2.json from the second call on when
# that file exists, and counts the call in pulls-calls. Every other call is
# appended to gh.log as one line of arguments and succeeds.
install_gh_stub() {
  STUB_DIR="${PWD}/stub"
  mkdir -p "$STUB_DIR"
  : >"${STUB_DIR}/gh.log"
  printf '[]\n' >"${STUB_DIR}/pulls.json"
  cat >"${STUB_DIR}/gh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
stub_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "${1:-}" = api ] && [[ ${2:-} == repos/*/commits/*/pulls ]]; then
  printf 'call\n' >>"${stub_dir}/pulls-calls"
  if [ "$(wc -l <"${stub_dir}/pulls-calls")" -gt 1 ] && [ -f "${stub_dir}/pulls-2.json" ]; then
    cat "${stub_dir}/pulls-2.json"
  else
    cat "${stub_dir}/pulls.json"
  fi
  exit 0
fi
printf '%s\n' "$*" >>"${stub_dir}/gh.log"
STUB
  chmod +x "${STUB_DIR}/gh"
}

with_gh_stub() { # <command...>
  PATH="${STUB_DIR}:${PATH}" "$@"
}

# release_pr_fixture <sha> [jq edit]: a commits/<sha>/pulls response holding
# release PR #900 for 0.34.0 as GitHub returned it for PR #752, with the
# optional edit applied to the PR.
release_pr_fixture() {
  jq -n --arg sha "$1" '[{
    number: 900,
    title: "chore(main): release 0.34.0",
    merged_at: "2026-09-15T18:56:44Z",
    merge_commit_sha: $sha,
    base: {ref: "main"},
    head: {ref: "release-please--branches--main", repo: {full_name: "sound-barrier/recall"}},
    user: {login: "github-actions[bot]"},
    labels: [{name: "autorelease: pending"}]
  } | '"${2:-.}"']'
}

expect_origin_tag() { # <tag> <want commit, empty for none> <label>
  local got
  got=$(git ls-remote origin "refs/tags/$1" | cut -f1)
  if [ "$got" = "$2" ]; then
    ok "$3"
  else
    not_ok "$3 (origin has '${got}', want '$2')"
  fi
}

expect_logged() { # <gh arguments> <label>
  if grep -qxF -- "$1" "${STUB_DIR}/gh.log"; then
    ok "$2"
  else
    not_ok "$2"
    sed 's/^/        | /' "${STUB_DIR}/gh.log"
  fi
}

expect_log_lacks() { # <text> <label>
  if grep -qF -- "$1" "${STUB_DIR}/gh.log"; then
    not_ok "$2"
    sed 's/^/        | /' "${STUB_DIR}/gh.log"
  else
    ok "$2"
  fi
}
