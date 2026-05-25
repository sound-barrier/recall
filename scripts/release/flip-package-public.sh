#!/usr/bin/env bash
# scripts/release/flip-package-public.sh — set the GHCR
# recall-server package visibility to public so users can pull without
# authentication.
#
# Called by release.yml after publish-container with continue-on-error
# because the workflow's GITHUB_TOKEN doesn't carry the write:packages
# OAuth scope required for visibility changes. The package must be set
# public once manually via GitHub Package settings; this script keeps
# trying so a future PAT/permissions upgrade activates it automatically.
#
# Required inputs (env vars):
#   GH_TOKEN                    — auth (release.yml passes GITHUB_TOKEN)
#   GITHUB_REPOSITORY           — e.g. "sound-barrier/recall"
#   GITHUB_REPOSITORY_OWNER     — e.g. "sound-barrier"
#
# Retries up to 5 times because the package registry may not be indexed
# immediately after the push.

set -euo pipefail

OWNER_TYPE=$(gh api "/repos/${GITHUB_REPOSITORY}" --jq '.owner.type')
if [ "$OWNER_TYPE" = "Organization" ]; then
  API_PATH="/orgs/${GITHUB_REPOSITORY_OWNER}/packages/container/recall-server"
else
  API_PATH="/user/packages/container/recall-server"
fi

for i in 1 2 3 4 5; do
  if gh api --method PATCH -H "Accept: application/vnd.github+json" \
    "$API_PATH" -f visibility=public; then
    exit 0
  fi
  printf 'Attempt %d failed, retrying in 15s...\n' "$i" >&2
  sleep 15
done

printf 'error: visibility-flip failed after 5 attempts\n' >&2
exit 1
