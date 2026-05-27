#!/usr/bin/env bash
# scripts/release/package-server-mac.sh — package the macOS server
# binary into a release-ready tarball. Called by the `build` matrix
# in .github/workflows/release.yml when matrix.target == server-mac.
#
# Required inputs (env vars):
#   VERSION   — e.g. "v0.1.1" (with the leading 'v', as released by tag)
#
# Required inputs (paths, must already exist):
#   dist/server-mac/Recall-server-arm64
#
# Output (in the current working directory):
#   recall-server-{V}-darwin-arm64.tar.gz
#
# `{V}` is VERSION with the leading 'v' stripped.

set -euo pipefail

if [ -z "${VERSION:-}" ]; then
  printf 'error: VERSION is required (e.g. VERSION=v0.1.1)\n' >&2
  exit 2
fi

PKG_VERSION="${VERSION#v}"

mkdir -p "_tar/recall-server-${PKG_VERSION}-darwin-arm64"
cp dist/server-mac/Recall-server-arm64 "_tar/recall-server-${PKG_VERSION}-darwin-arm64/recall-server"
tar -czf "recall-server-${PKG_VERSION}-darwin-arm64.tar.gz" -C _tar "recall-server-${PKG_VERSION}-darwin-arm64"
