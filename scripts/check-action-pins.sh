#!/usr/bin/env bash
# scripts/check-action-pins.sh — enforce SHA pinning on every external
# GitHub Action referenced from .github/workflows/ and the first-party
# composite actions under .github/actions/.
#
# Policy: third-party actions must be pinned by 40-char commit SHA with
# a trailing `# vX.Y.Z` comment, e.g.
#   uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4
#
# Tag pins (`uses: actions/checkout@v4`) are forbidden — a compromised
# maintainer account or stolen token could silently re-point a tag to a
# malicious commit. Dependabot understands the SHA + version-comment
# format and bumps both fields together on its weekly run.
#
# First-party composite actions (./.github/actions/foo) are themselves
# exempt from SHA pinning (they live in this repo), but any external
# actions they reference are NOT — scanning both directories keeps the
# supply-chain perimeter consistent.
#
# Usage: bash scripts/check-action-pins.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKFLOWS_DIR="${ROOT}/.github/workflows"
COMPOSITE_DIR="${ROOT}/.github/actions"

if [ ! -d "${WORKFLOWS_DIR}" ]; then
  printf 'error: %s does not exist\n' "${WORKFLOWS_DIR}" >&2
  exit 1
fi

# Compose the source list. The composite-actions dir is optional —
# silently skip when none exist yet.
SCAN_DIRS=("${WORKFLOWS_DIR}")
if [ -d "${COMPOSITE_DIR}" ]; then
  SCAN_DIRS+=("${COMPOSITE_DIR}")
fi

# Extract every "uses: ..." line, normalise leading whitespace + the
# optional `-`. We only care about external refs of the form
# `<owner>/<repo>[/<subpath>]@<version>`.
unpinned=()
while IFS= read -r line; do
  ref=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*-?[[:space:]]*uses:[[:space:]]*//')

  # First-party composite action — skip.
  [[ "$ref" == ./* ]] && continue
  [[ "$ref" == .github/* ]] && continue

  # Strip any trailing comment so we can examine the bare ref.
  bare=$(printf '%s' "$ref" | sed -E 's/[[:space:]]+#.*$//')

  # Acceptable form: <owner>/<repo>[/<subpath>]@<40-hex>
  if [[ "$bare" =~ ^[^@]+@[a-f0-9]{40}$ ]]; then
    # SHA-pinned. Also require the trailing `# vX.Y.Z` comment so
    # bumps stay legible — otherwise we lose the human-readable version
    # marker that makes review feasible.
    if [[ ! "$ref" =~ \ \ #\ v ]]; then
      unpinned+=("${ref}  (SHA-pinned but missing '  # vX.Y.Z' comment)")
    fi
    continue
  fi

  # Anything else (tag, branch, latest) is unpinned.
  unpinned+=("${ref}")
done < <(grep -rhE "^\s*-?\s*uses:\s" "${SCAN_DIRS[@]}")

if [ ${#unpinned[@]} -eq 0 ]; then
  exit 0
fi

printf 'Unpinned or improperly-pinned action references:\n' >&2
for u in "${unpinned[@]}"; do
  printf '  %s\n' "$u" >&2
done
# shellcheck disable=SC2016  # backticks are literal markdown formatting in this user-facing message, not command substitution
printf '\nPolicy: third-party actions must be SHA-pinned with a `  # vX.Y.Z` comment.\n' >&2
printf 'See CONTRIBUTING.md → "Pinning GitHub Actions".\n' >&2
exit 1
