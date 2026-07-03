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
#   dist/windows/recall-amd64-installer.exe   — NSIS installer (human download)
#   dist/windows/Recall.exe                   — raw app exe (in-app updater target)
#
# Outputs (in the current working directory):
#   recall-{V}-windows-amd64-installer.exe    — installer
#   recall-{V}-windows-amd64.exe              — raw exe the Wails updater swaps
#
# The raw exe is the asset the in-app self-updater downloads and swaps in
# place. It carries no MOTW/SmartScreen concern here: the updater streams the
# bytes directly (never a browser download), and it must NOT be the NSIS
# installer (the updater can't run an installer, only replace a single file).

set -euo pipefail

if [ -z "${VERSION:-}" ]; then
  printf 'error: VERSION is required (e.g. VERSION=v0.1.1)\n' >&2
  exit 2
fi

PKG_VERSION="${VERSION#v}"

cp dist/windows/recall-amd64-installer.exe "recall-${PKG_VERSION}-windows-amd64-installer.exe"
cp dist/windows/Recall.exe "recall-${PKG_VERSION}-windows-amd64.exe"
