# shellcheck shell=bash
# Smoke cases for scripts/release/push-release-tag.sh. Sourced by ../smoke.sh,
# which sets RELEASE_DIR and REPO_ROOT and loads ../lib/_harness.sh.

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
