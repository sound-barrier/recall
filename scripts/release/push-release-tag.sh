#!/usr/bin/env bash
# scripts/release/push-release-tag.sh — companion to release-please.yml.
#
# Why this exists: release-please-action with `skip-github-release: true`
# in `release-please-config.json` does NOT push the git tag for a
# just-merged release PR. The strategy bundles tag creation with
# GitHub Release creation — skipping the latter skips both, and
# release-please's outstanding-PR check then aborts subsequent runs
# with "There are untagged, merged release PRs outstanding". v0.2.2
# and v0.2.3 shipped this way, both requiring a manual `git tag` +
# `git push origin v...` from the maintainer's shell.
#
# This script automates that step. It pushes and dispatches nothing until
# every guard has passed, because a pushed tag is what release.yml builds:
#   1. Reads the subject of $HEAD_COMMIT_MSG. Anything but release-please's
#      `chore(main): release X.Y.Z` is a clean no-op (every other push).
#   2. Requires the checkout to be $GITHUB_SHA, the commit that was pushed.
#   3. Resolves vX.Y.Z on origin. A tag that already exists must point at
#      HEAD: one anywhere else was pushed by someone else first ("tag
#      squatting"), and skipping past it, as this script once did, left the
#      squatted tag as the release. A tag at HEAD means a re-run.
#   4. Runs verify-release-ref.sh: the manifest names the version, the
#      subject is the release subject and HEAD is on origin/main.
#   5. Finds the merged release PR among the commit's associated pull
#      requests: merged into main from release-please--branches--main in this
#      repository, opened by github-actions[bot], titled for this version and
#      merged as this very commit. One retry covers the API's indexing lag.
#   6. Pushes the tag and fires release.yml with `gh workflow run`, because
#      GitHub's anti-loop guard suppresses release.yml's `push: tags` trigger
#      for a tag pushed with GITHUB_TOKEN. A re-run whose tag is already at
#      HEAD does neither again.
#   7. Flips the PR's label from `autorelease: pending` to `autorelease:
#      tagged` so release-please's next run does not abort. This runs on a
#      re-run too, so re-running the job repairs a label flip that failed.
#
# Required inputs (env vars):
#   HEAD_COMMIT_MSG    github.event.head_commit.message
#   GITHUB_SHA         the pushed commit (set by Actions)
#   GITHUB_REPOSITORY  owner/repo (set by Actions)
#   GH_TOKEN           contents: write (tag push, through the checkout's
#                      credential), actions: write, pull-requests: write
# Optional:
#   RELEASE_PR_RETRY_DELAY  seconds before the PR lookup retry (default 10)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly RELEASE_BRANCH="release-please--branches--main"
readonly RELEASE_BOT="github-actions[bot]"

TAG_CREATED=0

require_inputs() {
  local input
  for input in HEAD_COMMIT_MSG GITHUB_SHA GITHUB_REPOSITORY; do
    if [ -z "${!input:-}" ]; then
      printf 'error: %s required\n' "$input" >&2
      exit 2
    fi
  done
}

# Sets VERSION and TAG, or exits 0 when the subject is not a release subject.
# Optional trailing " (#NN)" tolerates a GitHub UI squash-merge; the repo
# merges by rebase, which keeps release-please's subject as written.
parse_release_subject() {
  local subject="${HEAD_COMMIT_MSG%%$'\n'*}"
  if [[ ! $subject =~ ^chore\(main\):\ release\ ([0-9]+\.[0-9]+\.[0-9]+([-.][a-zA-Z0-9.-]+)?)(\ \(#[0-9]+\))?$ ]]; then
    printf 'Not a release-please merge commit; skipping tag push.\n  subject: %q\n' "$subject"
    exit 0
  fi
  VERSION="${BASH_REMATCH[1]}"
  TAG="v${VERSION}"
}

require_pushed_commit() {
  HEAD_SHA=$(git rev-parse HEAD)
  if [ "$HEAD_SHA" != "$GITHUB_SHA" ]; then
    printf '::error::HEAD is %s, not the pushed commit %s\n' "$HEAD_SHA" "$GITHUB_SHA" >&2
    exit 1
  fi
}

delete_unpushed_tag() {
  if [ "$TAG_CREATED" = 1 ]; then
    git tag -d "$TAG" >/dev/null || true
  fi
}

# Sets TAG_PREEXISTED to 1 for a tag already on origin at HEAD, 0 when this
# run created it locally. A local tag is created either way because
# verify-release-ref.sh checks where the tag points.
resolve_tag() {
  local remote_rc=0 tag_commit
  git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null || remote_rc=$?
  case "$remote_rc" in
    0)
      git fetch -q --no-tags origin "+refs/tags/${TAG}:refs/tags/${TAG}"
      tag_commit=$(git rev-parse "refs/tags/${TAG}^{commit}")
      if [ "$tag_commit" != "$HEAD_SHA" ]; then
        printf '::error title=Tag squatting::%s already exists at %s, not at the release commit %s\n' \
          "$TAG" "$tag_commit" "$HEAD_SHA" >&2
        exit 1
      fi
      TAG_PREEXISTED=1
      ;;
    2)
      git config user.name "$RELEASE_BOT"
      git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
      git tag "$TAG"
      TAG_CREATED=1
      TAG_PREEXISTED=0
      ;;
    *)
      printf '::error::git ls-remote could not read tags from origin (exit %s)\n' "$remote_rc" >&2
      exit 1
      ;;
  esac
}

# Prints {"number": N, "pending": bool} for the merged release PR, or nothing.
# gh prints the raw response and jq filters it here, so a failing gh call
# fails the script instead of reading as "no PR".
find_release_pr() {
  gh api "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/pulls" \
    | jq -c --arg repo "$GITHUB_REPOSITORY" --arg sha "$GITHUB_SHA" \
      --arg branch "$RELEASE_BRANCH" --arg bot "$RELEASE_BOT" \
      --arg title "chore(main): release ${VERSION}" '
        [.[] | select(.merged_at != null and .base.ref == "main"
          and .head.ref == $branch and .head.repo.full_name == $repo
          and .user.login == $bot and .title == $title
          and .merge_commit_sha == $sha)
        | {number, pending: ([.labels[].name] | index("autorelease: pending") != null)}]
        | first // empty'
}

# Sets RELEASE_PR, or exits 1 when neither lookup finds it.
require_release_pr() {
  local delay="${RELEASE_PR_RETRY_DELAY:-10}"
  RELEASE_PR=$(find_release_pr)
  if [ -z "$RELEASE_PR" ]; then
    printf 'No merged release PR found for %s on the first lookup; retrying in %ss\n' "$TAG" "$delay" >&2
    sleep "$delay"
    RELEASE_PR=$(find_release_pr)
  fi
  if [ -z "$RELEASE_PR" ]; then
    printf '::error::no merged release PR from %s by %s was merged as %s; %s was not pushed.\n' \
      "$RELEASE_BRANCH" "$RELEASE_BOT" "$HEAD_SHA" "$TAG" >&2
    printf '  If the API was only slow, re-run this job. Otherwise find out how this commit reached main.\n' >&2
    printf '  Until %s is tagged and its PR labeled, release-please will refuse to open new release PRs.\n' "$TAG" >&2
    exit 1
  fi
}

push_and_dispatch() {
  if [ "$TAG_PREEXISTED" = 1 ]; then
    printf 'Tag %s already points at %s; not pushing or dispatching again.\n' "$TAG" "$HEAD_SHA"
    printf '::notice::If no Release run exists for %s, dispatch one: task release-fire TAG=%s\n' "$TAG" "$TAG"
    return 0
  fi
  git push origin "$TAG"
  TAG_CREATED=0
  printf 'Pushed tag %s at %s\n' "$TAG" "$HEAD_SHA"
  gh workflow run release.yml --ref "$TAG"
  printf 'Triggered release.yml for %s; it waits for approval of the release environment.\n' "$TAG"
}

flip_pending_label() {
  local number
  number=$(jq -r .number <<<"$RELEASE_PR")
  if [ "$(jq -r .pending <<<"$RELEASE_PR")" != true ]; then
    printf 'PR #%s is not labeled autorelease: pending; leaving its labels alone.\n' "$number"
    return 0
  fi
  gh pr edit "$number" \
    --remove-label "autorelease: pending" \
    --add-label "autorelease: tagged"
  printf 'Flipped PR #%s label: autorelease: pending -> tagged\n' "$number"
}

main() {
  require_inputs
  parse_release_subject
  require_pushed_commit
  trap delete_unpushed_tag EXIT
  resolve_tag
  TAG="$TAG" SHA="$HEAD_SHA" REF_TYPE=tag bash "${SCRIPT_DIR}/verify-release-ref.sh"
  require_release_pr
  push_and_dispatch
  flip_pending_label
}

main "$@"
