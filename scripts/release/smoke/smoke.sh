#!/usr/bin/env bash
# scripts/release/smoke/smoke.sh — smoke-test scripts/release/*.sh without
# cutting a real tag. Each test case:
#   1. cd into a fresh per-case temp dir
#   2. stages the fixture filesystem the script under test expects
#   3. runs the script with stub env vars
#   4. asserts the expected output files exist (or, for input-validation
#      tests, that the script exits with the documented sentinel code).
#
# Why this exists: release.yml's `push: tags: v*` trigger means the only
# "real" way to validate an edit to a release script was a fresh tag —
# destructive iteration. With this test, contributors can edit the
# scripts and `task smoke-release-scripts` to know their changes survive
# the most common code paths in seconds.
#
# Recall ships a Windows desktop app only. package-wails-windows.sh needs a
# real build tree and is exercised by CI's build job; every other release
# script is smoke-tested here. The ref guards run against scratch git
# repositories: a bare origin plus a clone, built per case.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${RELEASE_DIR}/../.." && pwd)"

# A published release the real-history cases check against this clone.
readonly HISTORY_TAG="v0.33.2"

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
  cd "$tmpdir"
  "$@" || rc=$?
  cd "$prev_dir"
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
  cd work
  git remote add origin ../origin.git
  printf 'base\n' >README.md
  git add README.md
  git commit -q -m 'feat: base'
  commit_release "$1" "$2"
  git push -q origin main
  git fetch -q origin
}

# ── compute-sha256.sh ────────────────────────────────────────────────

smoke_compute_sha256() {
  printf '\n# compute-sha256.sh\n'
  if ! command -v sha256sum >/dev/null 2>&1; then
    skip "compute-sha256.sh smoke" "sha256sum not on PATH (try shasum -a 256 instead)"
    return 0
  fi
  run_in_temp _smoke_compute_sha256_inner
}

_smoke_compute_sha256_inner() {
  # Plant one fake artifact of each shape the script's glob matches:
  # the installer exe, the raw updater exe, a reference YAML, the bat.
  printf 'a\n' >recall-0.0.0-smoke-windows-amd64-installer.exe
  printf 'b\n' >recall-0.0.0-smoke-windows-amd64.exe
  printf 'c\n' >recall-0.0.0-smoke-heroes.yaml
  printf 'd\n' >recall-0.0.0-smoke-Reset-Database.bat

  # Also a non-matching file — the glob must NOT pick it up.
  printf 'not-recall\n' >unrelated-file.exe

  if ! bash "${RELEASE_DIR}/compute-sha256.sh" >/dev/null 2>&1; then
    not_ok "compute-sha256.sh exited non-zero"
    return 0
  fi
  ok "compute-sha256.sh exited zero"

  local f
  for f in recall-0.0.0-smoke-windows-amd64-installer.exe \
    recall-0.0.0-smoke-windows-amd64.exe \
    recall-0.0.0-smoke-heroes.yaml \
    recall-0.0.0-smoke-Reset-Database.bat; do
    if [ -f "${f}.sha256" ]; then
      ok "compute-sha256.sh produced ${f}.sha256"
    else
      not_ok "compute-sha256.sh missing ${f}.sha256"
    fi
  done

  # The combined SHA256SUMS the in-app updater consumes must exist.
  if [ -f SHA256SUMS ]; then
    ok "compute-sha256.sh produced SHA256SUMS"
  else
    not_ok "compute-sha256.sh missing SHA256SUMS"
  fi

  if [ -f unrelated-file.exe.sha256 ]; then
    not_ok "compute-sha256.sh picked up unrelated-file.exe (glob too wide)"
  else
    ok "compute-sha256.sh leaves non-recall-* files alone"
  fi
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

# ── verify-release-ref.sh ────────────────────────────────────────────

verify_ref() { # <tag> <sha> <ref type>
  TAG=$1 SHA=$2 REF_TYPE=$3 bash "${RELEASE_DIR}/verify-release-ref.sh"
}

smoke_verify_release_ref() {
  printf '\n# verify-release-ref.sh\n'
  run_in_temp _verify_accepts 0.34.0 'chore(main): release 0.34.0' \
    "accepts a release-please commit on main"
  run_in_temp _verify_accepts 0.0.13-beta.0 'chore(main): release 0.0.13-beta.0' \
    "accepts a prerelease"
  run_in_temp _verify_accepts 0.34.0 'chore(main): release 0.34.0 (#752)' \
    "accepts a subject carrying the PR number"
  run_in_temp _verify_rejects_branch_ref
  run_in_temp _verify_rejects_tag_grammar
  run_in_temp _verify_rejects_tag_elsewhere
  run_in_temp _verify_rejects_manifest_mismatch
  run_in_temp _verify_rejects_subject
  run_in_temp _verify_rejects_unescaped_version
  run_in_temp _verify_rejects_side_branch
  run_case "exits 2 without TAG" 2 "required" verify_ref "" HEAD tag
  smoke_verify_release_ref_history
}

_verify_accepts() { # <version> <subject> <label>
  make_release_repo "$1" "$2"
  git tag "v$1"
  run_case "$3" 0 "" verify_ref "v$1" "$(git rev-parse HEAD)" tag
}

_verify_rejects_branch_ref() {
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  git tag v0.34.0
  run_case "rejects a run on a branch" 1 "not a tag" \
    verify_ref v0.34.0 "$(git rev-parse HEAD)" branch
}

_verify_rejects_tag_grammar() {
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  git tag release-0.34.0
  run_case "rejects a tag outside the vX.Y.Z grammar" 1 "not a vX.Y.Z release tag" \
    verify_ref release-0.34.0 "$(git rev-parse HEAD)" tag
}

_verify_rejects_tag_elsewhere() {
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  git tag v0.34.0 HEAD~1
  run_case "rejects a tag that points at another commit" 1 "points at" \
    verify_ref v0.34.0 "$(git rev-parse HEAD)" tag
}

_verify_rejects_manifest_mismatch() {
  make_release_repo 0.33.2 'chore(main): release 0.34.0'
  git tag v0.34.0
  run_case "rejects a manifest that names another version" 1 ".release-please-manifest.json" \
    verify_ref v0.34.0 "$(git rev-parse HEAD)" tag
}

_verify_rejects_subject() {
  make_release_repo 0.34.0 'feat: x'
  git tag v0.34.0
  run_case "rejects a commit that is not a release commit" 1 "subject" \
    verify_ref v0.34.0 "$(git rev-parse HEAD)" tag
}

# A version's dots must match only dots: 0x34x0 is not release 0.34.0.
_verify_rejects_unescaped_version() {
  make_release_repo 0.34.0 'chore(main): release 0x34x0'
  git tag v0.34.0
  run_case "rejects a subject that only pattern-matches the version" 1 "subject" \
    verify_ref v0.34.0 "$(git rev-parse HEAD)" tag
}

_verify_rejects_side_branch() {
  make_release_repo 0.33.2 'chore(main): release 0.33.2'
  git checkout -q -b side
  commit_release 0.34.0 'chore(main): release 0.34.0'
  git tag v0.34.0
  run_case "rejects a release commit that is not on main" 1 "is not on" \
    verify_ref v0.34.0 "$(git rev-parse HEAD)" tag
}

# The scratch cases hold the script to release-please's documented shape;
# these hold it to what release-please actually wrote. They need this
# clone's full history, which CI's lint job checks out, so only a local
# shallow or tagless clone may skip them.
smoke_verify_release_ref_history() {
  local sha
  if [ "$(git -C "$REPO_ROOT" rev-parse --is-shallow-repository)" = true ] \
    || ! sha=$(git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/${HISTORY_TAG}^{commit}") \
    || ! git -C "$REPO_ROOT" rev-parse -q --verify refs/remotes/origin/main >/dev/null; then
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
      not_ok "real-history cases need full history, ${HISTORY_TAG} and origin/main"
    else
      skip "real-history cases" "clone lacks full history, ${HISTORY_TAG} or origin/main"
    fi
    return 0
  fi
  run_case "accepts the published ${HISTORY_TAG} release commit" 0 "" \
    verify_ref_in_repo "$HISTORY_TAG" "$sha" tag
  run_case "rejects ${HISTORY_TAG} with a non-release commit" 1 "points at" \
    verify_ref_in_repo "$HISTORY_TAG" "$(git -C "$REPO_ROOT" rev-parse "${sha}^")" tag
}

verify_ref_in_repo() { # <tag> <sha> <ref type>
  (cd "$REPO_ROOT" && verify_ref "$@")
}

# ── push-release-tag.sh ──────────────────────────────────────────────

push_tag() { # <head commit message> — as release-please.yml's step runs it
  with_gh_stub env HEAD_COMMIT_MSG="$1" GITHUB_SHA="$(git rev-parse HEAD)" \
    GITHUB_REPOSITORY=sound-barrier/recall RELEASE_PR_RETRY_DELAY=0 \
    bash "${RELEASE_DIR}/push-release-tag.sh"
}

smoke_push_release_tag() {
  printf '\n# push-release-tag.sh\n'
  run_in_temp _push_tag_skips_other_subjects
  run_in_temp _push_tag_happy_path
  run_in_temp _push_tag_finds_pr_on_retry
  run_in_temp _push_tag_rejects_manifest_mismatch
  # One case per clause of the lookup filter, so each clause is load-bearing.
  run_in_temp _push_tag_rejects_pr "an unmerged PR" '.merged_at = null'
  run_in_temp _push_tag_rejects_pr "a PR into another base" '.base.ref = "release"'
  run_in_temp _push_tag_rejects_pr "a PR from another branch" '.head.ref = "feature/x"'
  run_in_temp _push_tag_rejects_pr "a PR from a fork" '.head.repo.full_name = "someone/recall"'
  run_in_temp _push_tag_rejects_pr "a PR opened by a person" '.user.login = "jacob-delgado"'
  run_in_temp _push_tag_rejects_pr "a PR titled for another version" '.title = "chore(main): release 0.33.2"'
  run_in_temp _push_tag_rejects_pr "a PR merged as another commit" '.merge_commit_sha = "0000000000000000000000000000000000000000"'
  run_in_temp _push_tag_rejects_missing_pr
  run_in_temp _push_tag_rejects_squatted_tag
  run_in_temp _push_tag_rerun_at_head
  run_in_temp _push_tag_rejects_other_checkout
  run_case "exits 2 without HEAD_COMMIT_MSG" 2 "HEAD_COMMIT_MSG" \
    env -u HEAD_COMMIT_MSG bash "${RELEASE_DIR}/push-release-tag.sh"
}

_push_tag_skips_other_subjects() {
  install_gh_stub
  make_release_repo 0.34.0 'feat: x'
  run_case "skips a push that is not a release commit" 0 "Not a release-please merge commit" \
    push_tag 'feat: x'
  expect_origin_tag v0.34.0 "" "  and pushes no tag"
  if [ -s "${STUB_DIR}/gh.log" ] || [ -e "${STUB_DIR}/pulls-calls" ]; then
    not_ok "  and never calls gh"
  else
    ok "  and never calls gh"
  fi
}

_push_tag_happy_path() {
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  release_pr_fixture "$(git rev-parse HEAD)" >"${STUB_DIR}/pulls.json"
  run_case "tags a merged release PR's commit" 0 "Pushed tag v0.34.0" \
    push_tag 'chore(main): release 0.34.0'
  expect_origin_tag v0.34.0 "$(git rev-parse HEAD)" "  at HEAD on origin"
  expect_logged "workflow run release.yml --ref v0.34.0" "  and dispatches release.yml on it"
  expect_logged "pr edit 900 --remove-label autorelease: pending --add-label autorelease: tagged" \
    "  and flips the PR's label to tagged"
}

_push_tag_finds_pr_on_retry() {
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  release_pr_fixture "$(git rev-parse HEAD)" >"${STUB_DIR}/pulls-2.json"
  run_case "finds a release PR the API lists only on the retry" 0 "Pushed tag v0.34.0" \
    push_tag 'chore(main): release 0.34.0'
  expect_origin_tag v0.34.0 "$(git rev-parse HEAD)" "  and tags it"
}

_push_tag_rejects_manifest_mismatch() {
  install_gh_stub
  make_release_repo 0.33.2 'chore(main): release 0.34.0'
  release_pr_fixture "$(git rev-parse HEAD)" >"${STUB_DIR}/pulls.json"
  run_case "refuses a release commit whose manifest names another version" 1 ".release-please-manifest.json" \
    push_tag 'chore(main): release 0.34.0'
  expect_nothing_released
}

_push_tag_rejects_pr() { # <what> <jq edit>
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  release_pr_fixture "$(git rev-parse HEAD)" "$2" >"${STUB_DIR}/pulls.json"
  run_case "refuses $1" 1 "no merged release PR" push_tag 'chore(main): release 0.34.0'
  expect_nothing_released
}

_push_tag_rejects_missing_pr() {
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  run_case "refuses when no PR is found on either lookup" 1 "no merged release PR" \
    push_tag 'chore(main): release 0.34.0'
  expect_nothing_released
}

_push_tag_rejects_squatted_tag() {
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  release_pr_fixture "$(git rev-parse HEAD)" >"${STUB_DIR}/pulls.json"
  local squatted
  squatted=$(git rev-parse HEAD~1)
  git tag v0.34.0 HEAD~1
  git push -q origin v0.34.0
  # The checkout may hold its own copy at HEAD; origin's is the one that counts.
  git tag -f v0.34.0 HEAD >/dev/null
  run_case "refuses a tag that already exists at another commit" 1 "Tag squatting" \
    push_tag 'chore(main): release 0.34.0'
  expect_origin_tag v0.34.0 "$squatted" "  and leaves origin's tag where it was"
  expect_log_lacks "workflow run" "  and dispatches nothing"
  expect_log_lacks "pr edit" "  and leaves the label alone"
}

_push_tag_rerun_at_head() {
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  release_pr_fixture "$(git rev-parse HEAD)" >"${STUB_DIR}/pulls.json"
  git tag v0.34.0
  git push -q origin v0.34.0
  run_case "re-run with the tag already at HEAD succeeds" 0 "task release-fire TAG=v0.34.0" \
    push_tag 'chore(main): release 0.34.0'
  expect_log_lacks "workflow run" "  without dispatching again"
  expect_logged "pr edit 900 --remove-label autorelease: pending --add-label autorelease: tagged" \
    "  and still flips a pending label"
}

_push_tag_rejects_other_checkout() {
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  release_pr_fixture "$(git rev-parse HEAD)" >"${STUB_DIR}/pulls.json"
  run_case "refuses when HEAD is not GITHUB_SHA" 1 "not the pushed commit" \
    with_gh_stub env HEAD_COMMIT_MSG='chore(main): release 0.34.0' \
    GITHUB_SHA="$(git rev-parse HEAD~1)" GITHUB_REPOSITORY=sound-barrier/recall \
    RELEASE_PR_RETRY_DELAY=0 bash "${RELEASE_DIR}/push-release-tag.sh"
  expect_nothing_released
}

expect_nothing_released() {
  expect_origin_tag v0.34.0 "" "  and pushes no tag"
  if [ -n "$(git tag -l v0.34.0)" ]; then
    not_ok "  and leaves no local tag behind"
  else
    ok "  and leaves no local tag behind"
  fi
  expect_log_lacks "workflow run" "  and dispatches nothing"
}

# ── main ─────────────────────────────────────────────────────────────

main() {
  printf 'Smoke-testing scripts/release/*.sh\n'
  isolate_git
  smoke_compute_sha256
  smoke_verify_release_ref
  smoke_push_release_tag

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

main "$@"
