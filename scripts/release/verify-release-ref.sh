#!/usr/bin/env bash
# scripts/release/verify-release-ref.sh — refuse to release a ref that is not
# release-please's release commit on main.
#
# release.yml builds and publishes whatever v* tag it runs on, and a tag can
# be pushed, or the workflow dispatched on one, by anyone with write access.
# Branch protection guards main, not tags. This holds the tag to the one
# commit release-please produces for that version, so a mistaken or stray tag
# on an unreviewed branch, on an older commit or under the wrong version is
# refused before anything builds:
#   1. the run is on a tag (REF_TYPE)
#   2. the tag is vX.Y.Z[-prerelease], push-release-tag.sh's version grammar
#   3. the tag points at SHA, the commit the run checked out
#   4. .release-please-manifest.json at SHA names the tag's version
#   5. SHA's subject is `chore(main): release X.Y.Z`, optionally ` (#N)`
#   6. SHA is reachable from MAIN_REF
#
# In release.yml it catches mistakes, not a tag pushed on purpose: the run
# uses release.yml and this script as they are at the tagged commit, and a
# commit that edits either can drop the check. push-release-tag.sh and
# fire-release.sh run it from main's checkout or the maintainer's clone, where
# the tagged commit cannot change it.
#
# The manifest and subject are read from SHA with git, never from the working
# tree, so any clone with the tag and main fetched can run it
# (fire-release.sh does, on the maintainer's machine).
#
# Inputs (env):
#   TAG       the tag being released, e.g. v0.34.0 (github.ref_name)
#   SHA       the commit being built (github.sha)
#   REF_TYPE  must be "tag" (github.ref_type)
#   MAIN_REF  default refs/remotes/origin/main
#
# Exit 0 when every check passes, 1 when one refuses, 2 on a usage error.

set -euo pipefail

readonly VERSION_PATTERN='[0-9]+\.[0-9]+\.[0-9]+([-.][a-zA-Z0-9.-]+)?'

reject() {
  printf '::error title=Release ref rejected::%s\n' "$1" >&2
  exit 1
}

if [ -z "${TAG:-}" ] || [ -z "${SHA:-}" ] || [ -z "${REF_TYPE:-}" ]; then
  printf 'error: TAG, SHA and REF_TYPE are required\n' >&2
  exit 2
fi
MAIN_REF="${MAIN_REF:-refs/remotes/origin/main}"

[ "$REF_TYPE" = tag ] \
  || reject "the run is on a ${REF_TYPE}, not a tag; releases build from tags only"

[[ $TAG =~ ^v(${VERSION_PATTERN})$ ]] \
  || reject "'${TAG}' is not a vX.Y.Z release tag"
VERSION="${BASH_REMATCH[1]}"

commit=$(git rev-parse -q --verify "${SHA}^{commit}") \
  || reject "${SHA} is not a commit in this clone"
tag_commit=$(git rev-parse -q --verify "refs/tags/${TAG}^{commit}") \
  || reject "tag ${TAG} does not exist in this clone"
[ "$tag_commit" = "$commit" ] \
  || reject "${TAG} points at ${tag_commit}, not at ${commit}"

manifest_version=$(git show "${commit}:.release-please-manifest.json" 2>/dev/null | jq -r '."."' 2>/dev/null) \
  || manifest_version=""
[ "$manifest_version" = "$VERSION" ] \
  || reject ".release-please-manifest.json at ${commit} reads '${manifest_version}', not ${VERSION}"

subject=$(git log -1 --format=%s "$commit")
[[ $subject =~ ^chore\(main\):\ release\ ${VERSION//./\\.}(\ \(#[0-9]+\))?$ ]] \
  || reject "the subject of ${commit} is not 'chore(main): release ${VERSION}': ${subject}"

git rev-parse -q --verify "${MAIN_REF}^{commit}" >/dev/null \
  || reject "${MAIN_REF} does not exist in this clone; fetch main first"
git merge-base --is-ancestor "$commit" "$MAIN_REF" \
  || reject "${commit} is not on ${MAIN_REF}"

printf 'Release ref verified: %s is the release-please commit %s on %s\n' "$TAG" "$commit" "$MAIN_REF"
