#!/usr/bin/env bash
# scripts/release/signing-status.sh — decide whether this release can be
# Authenticode-signed, and say so loudly either way.
#
# Called by the build-windows job in .github/workflows/release.yml. Writes
# `enabled=true|false` to $GITHUB_OUTPUT so the signing steps can gate on it.
#
# Why this degrades instead of failing: SignPath credentials are issued to a
# human, not to the repo, and the SignPath Foundation OSS application takes
# days to approve. Hard-failing the release job on a missing secret would mean
# no release at all until that lands. So an unsigned release stays POSSIBLE --
# but never quiet. Windows Defender flagged an unsigned build as malware once
# already (a false positive on Trojan:Win32/Wacatac.B!ml, the classic verdict
# for an unsigned Go binary with no download reputation), and a release that
# ships unsigned without saying so is how that recurs unnoticed.
#
# Required input (env):
#   SIGNPATH_API_TOKEN — empty or unset means "cannot sign"
#
# Output ($GITHUB_OUTPUT):
#   enabled=true|false

set -euo pipefail

if [ -z "${GITHUB_OUTPUT:-}" ]; then
  printf 'error: GITHUB_OUTPUT is required (this script runs inside Actions)\n' >&2
  exit 2
fi

if [ -n "${SIGNPATH_API_TOKEN:-}" ]; then
  echo "enabled=true" >>"${GITHUB_OUTPUT}"
  printf '[ recall ] signing credentials present — artifacts will be Authenticode-signed\n'
  exit 0
fi

echo "enabled=false" >>"${GITHUB_OUTPUT}"
printf '[ recall ] no SIGNPATH_API_TOKEN — this release will be UNSIGNED\n'

# ::warning:: surfaces on the run summary and the job log, so an unsigned
# release is visible without reading 400 lines of build output.
printf '::warning title=Release artifacts are UNSIGNED::'
printf 'SIGNPATH_API_TOKEN is not set, so recall.exe and the installer ship '
printf 'without an Authenticode signature. Windows Defender and SmartScreen '
printf 'will likely flag them. See docs/signing.md.\n'
