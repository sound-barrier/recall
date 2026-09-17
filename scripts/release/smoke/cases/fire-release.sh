# shellcheck shell=bash
# Smoke cases for scripts/release/fire-release.sh. Sourced by ../smoke.sh,
# which sets RELEASE_DIR and REPO_ROOT and loads ../lib/_harness.sh.

fire_release() { # <tag>
  with_gh_stub env TAG="$1" bash "${RELEASE_DIR}/fire-release.sh"
}

smoke_fire_release() {
  printf '\n# fire-release.sh\n'
  run_in_temp _fire_dispatches_release_commit
  run_in_temp _fire_rejects_side_branch_tag
  run_in_temp _fire_rejects_manifest_mismatch
  run_in_temp _fire_checks_origins_tag
  run_in_temp _fire_rejects_missing_tag
  run_in_temp _fire_rejects_tag_pattern
  run_case "exits 2 without TAG" 2 "TAG is required" env -u TAG bash "${RELEASE_DIR}/fire-release.sh"
  if command -v task >/dev/null 2>&1; then
    run_in_temp _fire_task_uses_command_line_tag
  else
    skip "task release-fire case" "task not on PATH; run task smoke-release-scripts"
  fi
}

# The tag lives only on origin, and the clone's origin/main is one commit
# stale, so a pass proves the script fetched both before verifying.
_fire_dispatches_release_commit() {
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  git tag v0.34.0
  git push -q origin v0.34.0
  git tag -d v0.34.0 >/dev/null
  git update-ref refs/remotes/origin/main HEAD~1
  run_case "dispatches release.yml on a release commit's tag" 0 "Approve and deploy" fire_release v0.34.0
  expect_logged "workflow run release.yml --ref v0.34.0" "  with gh workflow run --ref v0.34.0"
}

_fire_rejects_side_branch_tag() {
  install_gh_stub
  make_release_repo 0.33.2 'chore(main): release 0.33.2'
  git checkout -q -b side
  commit_release 0.34.0 'chore(main): release 0.34.0'
  git tag v0.34.0
  git push -q origin v0.34.0
  run_case "refuses a tag on a commit that is not on main" 1 "is not on" fire_release v0.34.0
  expect_log_lacks "workflow run" "  and dispatches nothing"
}

_fire_rejects_manifest_mismatch() {
  install_gh_stub
  make_release_repo 0.33.2 'chore(main): release 0.34.0'
  git tag v0.34.0
  git push -q origin v0.34.0
  run_case "refuses a tag whose manifest names another version" 1 ".release-please-manifest.json" \
    fire_release v0.34.0
  expect_log_lacks "workflow run" "  and dispatches nothing"
}

# A local tag at the real release commit must not vouch for origin's tag,
# which is the one release.yml checks out.
_fire_checks_origins_tag() {
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  local squatted
  squatted=$(git rev-parse HEAD~1)
  git tag v0.34.0 HEAD~1
  git push -q origin v0.34.0
  git tag -f v0.34.0 HEAD >/dev/null
  run_case "verifies origin's tag, not a local copy" 1 "$squatted" fire_release v0.34.0
  expect_log_lacks "workflow run" "  and dispatches nothing"
}

_fire_rejects_missing_tag() {
  install_gh_stub
  make_release_repo 0.34.0 'chore(main): release 0.34.0'
  run_case "exits 2 for a tag origin does not have" 2 "not found on origin" fire_release v0.34.0
  expect_log_lacks "workflow run" "  and dispatches nothing"
}

# git ls-remote and git fetch read a TAG like v0.33.* as a pattern.
_fire_rejects_tag_pattern() {
  install_gh_stub
  make_release_repo 0.33.2 'chore(main): release 0.33.2'
  git tag v0.33.2
  git push -q origin v0.33.2
  git tag -d v0.33.2 >/dev/null
  run_case "exits 2 for a TAG that is not a tag name" 2 "not a valid tag name" fire_release 'v0.33.*'
  if [ -n "$(git tag -l)" ]; then
    not_ok "  and fetches no tags"
  else
    ok "  and fetches no tags"
  fi
}

# go-task lets a TAG already exported in the shell override a task-level env:
# entry, so this runs the task, not only the script. The exported tag is a
# valid release too, so taking it would dispatch the wrong release, not fail.
_fire_task_uses_command_line_tag() {
  install_gh_stub
  make_release_repo 0.33.2 'chore(main): release 0.33.2'
  git tag v0.33.2
  commit_release 0.34.0 'chore(main): release 0.34.0'
  git tag v0.34.0
  git push -q origin main v0.33.2 v0.34.0
  # The task runs from the repository root, so origin must not be relative.
  git remote set-url origin "$(cd ../origin.git && pwd)"
  run_case "task release-fire dispatches the TAG on its command line" 0 "Approve and deploy" \
    with_gh_stub env TAG=v0.33.2 GIT_DIR="${PWD}/.git" \
    task --taskfile "${REPO_ROOT}/Taskfile.yml" release-fire TAG=v0.34.0
  expect_logged "workflow run release.yml --ref v0.34.0" "  not the TAG exported in the shell"
}
