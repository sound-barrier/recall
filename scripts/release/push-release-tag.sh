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
#   4. Fire release.yml explicitly via `gh workflow run release.yml
#      --ref vX.Y.Z`. The tag push itself comes from
#      github-actions[bot] (GITHUB_TOKEN auth), and GitHub's anti-
#      loop guard would otherwise suppress release.yml's `push: tags`
#      trigger. The workflow_dispatch path bypasses that guard.
#   5. Flip the just-merged release PR's label from
#      `autorelease: pending` to `autorelease: tagged` so
#      release-please doesn't see it as outstanding on the next run.
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

# Explicitly fire release.yml via workflow_dispatch. Required because
# GitHub's anti-loop guard suppresses workflow chaining when refs are
# pushed by github-actions[bot] (which the GITHUB_TOKEN auth surfaces
# us as) — release.yml's `push: tags` trigger doesn't fire on its
# own. The workflow_dispatch trigger lives on release.yml itself
# (added as the documented manual fallback) so this just exercises
# that same path automatically. Needs actions: write permission on
# the calling job, which release-please.yml grants explicitly.
gh workflow run release.yml --ref "${TAG}"
printf 'Triggered release.yml for %s\n' "${TAG}"

# Find the merged release PR for this version and flip its label.
# Filtering by state + label + post-filter on title is unambiguous —
# release-please only ever has ONE "autorelease: pending" merged PR
# for a given version (any prior attempt is either closed-unmerged
# or already flipped to "autorelease: tagged"). The post-filter on
# title is belt-and-suspenders.
#
# `--search` is deliberately NOT used here: GitHub PR search treats
# `:` as a qualifier separator (e.g. `is:merged`, `label:"x"`), so
# `chore(main): release X.Y.Z` is parsed as the qualifier `chore(main)`
# with the unknown value `release ...` — the call returns empty.
# Filtering by --state + --label and then jq-matching the title
# avoids the search parser entirely.
#
# Stderr stays attached so a `gh` failure (auth, rate limit, etc.)
# surfaces in the run log. The previous shape masked errors with
# `2>/dev/null || echo ""`, which stranded v0.9.0 in `autorelease:
# pending` after a transient lookup failure — release-please's
# outstanding-PR check then aborted every subsequent run with
# "There are untagged, merged release PRs outstanding" until the
# label was flipped by hand.
#
# Empty-result retry covers the indexing race between the merge
# event and the PR-list API. One retry with a short backoff is
# enough for steady-state runs; a persistently-empty result aborts
# loudly so the maintainer can investigate before the next release.
find_merged_release_pr() {
  gh pr list \
    --state merged \
    --label "autorelease: pending" \
    --json number,title \
    --jq "[.[] | select(.title == \"chore(main): release ${VERSION}\") | .number] | first // empty"
}

PR_NUMBER="$(find_merged_release_pr)"
if [ -z "$PR_NUMBER" ]; then
  printf 'no merged release PR found for %s on first lookup; retrying after 10s\n' "${TAG}" >&2
  sleep 10
  PR_NUMBER="$(find_merged_release_pr)"
fi

if [ -z "$PR_NUMBER" ]; then
  printf 'error: could not find merged release PR for %s after retry.\n' "${TAG}" >&2
  printf '  Flip the label by hand:\n' >&2
  printf "    gh pr list --state merged --label 'autorelease: pending' --json number,title\n" >&2
  printf "    gh pr edit <NUMBER> --remove-label 'autorelease: pending' --add-label 'autorelease: tagged'\n" >&2
  printf '  Until this is done, release-please will refuse to open new release PRs.\n' >&2
  exit 1
fi

gh pr edit "$PR_NUMBER" \
  --remove-label "autorelease: pending" \
  --add-label "autorelease: tagged"
printf 'Flipped PR #%s label: autorelease: pending → tagged\n' "$PR_NUMBER"
