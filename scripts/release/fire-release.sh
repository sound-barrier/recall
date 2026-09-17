#!/usr/bin/env bash
# scripts/release/fire-release.sh — `task release-fire`: dispatch release.yml
# on an existing tag, for when the automatic dispatch in release-please.yml
# did not happen.
#
# It dispatches only after verify-release-ref.sh accepts origin's tag and
# origin's main, both fetched first, so the maintainer's machine never starts
# a release for a tag that release.yml's verify-ref job would refuse, a
# squatted tag included. A stale local tag or origin/main cannot vouch for
# either.
#
# Inputs (env):
#   TAG  the release tag, e.g. v0.34.0
#
# Exit 0 once dispatched, 1 when the tag is refused, 2 on a usage error or a
# tag origin does not have.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

require_inputs() {
  if [ -z "${TAG:-}" ]; then
    printf 'error: TAG is required (e.g. task release-fire TAG=v0.0.13-beta.0)\n' >&2
    exit 2
  fi
  # git ls-remote and git fetch would read a glob in TAG as a pattern.
  if ! git check-ref-format "refs/tags/${TAG}"; then
    printf "error: '%s' is not a valid tag name\n" "$TAG" >&2
    exit 2
  fi
  if ! command -v gh >/dev/null 2>&1; then
    printf 'error: gh CLI not installed (brew install gh, then gh auth login)\n' >&2
    exit 2
  fi
}

fetch_tag_and_main() {
  local remote_rc=0
  git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null || remote_rc=$?
  if [ "$remote_rc" = 2 ]; then
    printf 'error: tag %s not found on origin\n' "$TAG" >&2
    exit 2
  elif [ "$remote_rc" != 0 ]; then
    printf 'error: git ls-remote could not read tags from origin (exit %s)\n' "$remote_rc" >&2
    exit 2
  fi
  git fetch -q --no-tags origin \
    "+refs/heads/main:refs/remotes/origin/main" \
    "+refs/tags/${TAG}:refs/tags/${TAG}"
}

main() {
  require_inputs
  fetch_tag_and_main
  TAG="$TAG" SHA="$(git rev-parse "refs/tags/${TAG}^{commit}")" REF_TYPE=tag \
    bash "${SCRIPT_DIR}/verify-release-ref.sh"
  gh workflow run release.yml --ref "$TAG"
  printf '\nrelease.yml dispatched for %s.\n' "$TAG"
  printf 'Next: Actions -> the Release run for %s -> Review deployments -> release -> Approve and deploy\n' "$TAG"
  printf 'Watch progress:  gh run list --workflow release.yml --limit 1\n'
}

main "$@"
