#!/usr/bin/env bash
# scripts/release/package-wails-windows.sh — copy the NSIS installer emitted by
# `task build-windows` (wails3 native cross-compile + makensis) into its
# release-ready filename. Called by the `build-windows` job in
# .github/workflows/release.yml.
#
# Required inputs (env vars):
#   VERSION   — e.g. "v0.1.1" (with the leading 'v', as released by tag)
#
# Required inputs (paths, must already exist):
#   dist/windows/recall-amd64-installer.exe
#
# Output (in the current working directory):
#   recall-{V}-windows-amd64-installer.exe

set -euo pipefail

if [ -z "${VERSION:-}" ]; then
  printf 'error: VERSION is required (e.g. VERSION=v0.1.1)\n' >&2
  exit 2
fi

PKG_VERSION="${VERSION#v}"

cp dist/windows/recall-amd64-installer.exe "recall-${PKG_VERSION}-windows-amd64-installer.exe"
