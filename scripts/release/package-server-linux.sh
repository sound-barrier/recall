#!/usr/bin/env bash
# scripts/release/package-server-linux.sh — package the Linux server
# binary into a release-ready tarball + .deb. Called by the `build`
# matrix in .github/workflows/release.yml when matrix.target ==
# server-linux.
#
# Required inputs (env vars):
#   VERSION   — e.g. "v0.1.1" (with the leading 'v', as released by tag)
#
# Required inputs (paths, must already exist):
#   dist/server-linux/Recall-server
#
# Outputs (in the current working directory):
#   recall-server-{V}-linux-amd64.tar.gz
#   recall-server-{V}-linux-amd64.deb
#
# `{V}` is VERSION with the leading 'v' stripped.

set -euo pipefail

if [ -z "${VERSION:-}" ]; then
  printf 'error: VERSION is required (e.g. VERSION=v0.1.1)\n' >&2
  exit 2
fi

PKG_VERSION="${VERSION#v}"

# ── Linux server binary — tarball ─────────────────────
mkdir -p "_tar/recall-server-${PKG_VERSION}-linux-amd64"
cp dist/server-linux/Recall-server "_tar/recall-server-${PKG_VERSION}-linux-amd64/recall-server"
tar -czf "recall-server-${PKG_VERSION}-linux-amd64.tar.gz" -C _tar "recall-server-${PKG_VERSION}-linux-amd64"

# ── Linux server binary — .deb (installs to /usr/local/bin/recall-server) ──
mkdir -p _deb-server/DEBIAN _deb-server/usr/local/bin
cp dist/server-linux/Recall-server _deb-server/usr/local/bin/recall-server
chmod 755 _deb-server/usr/local/bin/recall-server
printf 'Package: recall-server\nVersion: %s\nArchitecture: amd64\nMaintainer: Jacob Delgado <jacob.delgado@gmail.com>\nDescription: Recall server - Overwatch match history HTTP server\n Headless HTTP server that serves match history data.\n' \
  "${PKG_VERSION}" >_deb-server/DEBIAN/control
dpkg-deb --build _deb-server "recall-server-${PKG_VERSION}-linux-amd64.deb"
