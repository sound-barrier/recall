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
# This script automates that manual step:
#   1. Reads the push event's head commit message from $HEAD_COMMIT_MSG.
#   2. If the subject matches release-please's canonical
#      `chore(main): release X.Y.Z` pattern, parse the version.
#   3. If the corresponding `vX.Y.Z` tag does NOT already exist on
#      origin (idempotency — protects against re-runs), push it.
#   4. Flip the just-merged release PR's label from
#      `autorelease: pending` to `autorelease: tagged` so
#      release-please doesn't see it as outstanding on the next run.
#
# Whether the tag push fires release.yml downstream depends on which
# token authenticated the push:
#   - RELEASE_PLEASE_TOKEN (a PAT) → release.yml fires automatically.
#   - GITHUB_TOKEN (the anti-loop guard suppresses workflow chaining)
#     → release.yml has to be fired manually via
#     `make release-fire TAG=vX.Y.Z` (or
#     `gh workflow run release.yml --ref vX.Y.Z`).
# Same constraint as release-please's normal tag-push.
#
# Required inputs (env vars):
#   HEAD_COMMIT_MSG  — github.event.head_commit.message from the
#                      workflow context
#   GH_TOKEN         — token with contents:write + pull-requests:write
#
# No-ops cleanly when:
#   - The commit subject doesn't match the release-please pattern
#     (every non-release push to main).
#   - The tag already exists on origin (re-run safety).

set -euo pipefail

if [ -z "${HEAD_COMMIT_MSG:-}" ]; then
  printf 'error: HEAD_COMMIT_MSG required\n' >&2
  exit 2
fi

# Read only the first line — release-please's subject is the only
# part of the commit message we want to pattern-match.
msg=$(printf '%s' "$HEAD_COMMIT_MSG" | head -1)

# Match release-please's canonical commit subject:
#   chore(main): release 0.2.3
#   chore(main): release 0.0.13-beta.0
#   chore(main): release 1.0.0-rc.1
# Optional trailing " (#NN)" tolerates GitHub UI squash-merges that
# append the PR number to the subject (the repo's rebase-merge policy
# preserves the original subject without it, but defense-in-depth).
if [[ ! "$msg" =~ ^chore\(main\):\ release\ ([0-9]+\.[0-9]+\.[0-9]+([-.][a-zA-Z0-9.-]+)?)(\ \(#[0-9]+\))?$ ]]; then
  printf 'Not a release-please merge commit; skipping tag push.\n  subject: %q\n' "$msg"
  exit 0
fi

VERSION="${BASH_REMATCH[1]}"
TAG="v${VERSION}"

if git ls-remote --tags origin "refs/tags/${TAG}" | grep -q "refs/tags/${TAG}"; then
  printf 'Tag %s already exists on origin; skipping.\n' "${TAG}"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git tag "${TAG}"
git push origin "${TAG}"
printf 'Pushed tag %s at %s\n' "${TAG}" "$(git rev-parse HEAD)"

# Find the merged release PR for this version and flip its label.
# Narrowing by title + state + label is unambiguous — release-please
# only ever has ONE "autorelease: pending" merged PR for a given
# version (any prior attempt would be either closed-unmerged or
# already flipped to "autorelease: tagged").
PR_NUMBER=$(gh pr list \
  --search "chore(main): release ${VERSION}" \
  --state merged \
  --label "autorelease: pending" \
  --json number \
  -q '.[0].number' 2>/dev/null || echo "")

if [ -n "$PR_NUMBER" ]; then
  gh pr edit "$PR_NUMBER" \
    --remove-label "autorelease: pending" \
    --add-label "autorelease: tagged"
  printf 'Flipped PR #%s label: autorelease: pending → tagged\n' "$PR_NUMBER"
else
  printf 'warning: could not find merged release PR for %s; label not updated.\n' "${TAG}" >&2
fi
