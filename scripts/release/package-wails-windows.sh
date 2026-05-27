#!/usr/bin/env bash
# scripts/release/package-wails-windows.sh — copy the NSIS installer
# emitted by Dockerfile.build into its release-ready filename. Called
# by the `build` matrix in .github/workflows/release.yml when
# matrix.target == wails-windows.
#
# Required inputs (env vars):
#   VERSION   — e.g. "v0.1.1" (with the leading 'v', as released by tag)
#
# Required inputs (paths, must already exist):
#   dist/windows/Recall-amd64-installer.exe
#
# Output (in the current working directory):
#   recall-{V}-windows-amd64-installer.exe

set -euo pipefail

if [ -z "${VERSION:-}" ]; then
  printf 'error: VERSION is required (e.g. VERSION=v0.1.1)\n' >&2
  exit 2
fi

PKG_VERSION="${VERSION#v}"

cp dist/windows/Recall-amd64-installer.exe "recall-${PKG_VERSION}-windows-amd64-installer.exe"
