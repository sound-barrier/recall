# shellcheck shell=bash
# Smoke cases for scripts/release/verify-release-ref.sh. Sourced by ../smoke.sh,
# which sets RELEASE_DIR and REPO_ROOT and loads ../lib/_harness.sh.

# A published release the real-history cases check against this clone.
readonly HISTORY_TAG="v0.33.2"

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
