#!/usr/bin/env bash
# scripts/release/package-server-windows.sh — copy the Windows server
# .exe into its release-ready filename. Called by the `build` matrix
# in .github/workflows/release.yml when matrix.target == server-windows.
#
# Required inputs (env vars):
#   VERSION   — e.g. "v0.1.1" (with the leading 'v', as released by tag)
#
# Required inputs (paths, must already exist):
#   dist/server-windows/Recall-server.exe
#
# Output (in the current working directory):
#   recall-server-{V}-windows-amd64.exe

set -euo pipefail

if [ -z "${VERSION:-}" ]; then
  printf 'error: VERSION is required (e.g. VERSION=v0.1.1)\n' >&2
  exit 2
fi

PKG_VERSION="${VERSION#v}"

cp dist/server-windows/Recall-server.exe "recall-server-${PKG_VERSION}-windows-amd64.exe"
