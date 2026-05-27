#!/usr/bin/env bash
# scripts/release/package-wails-linux.sh — package the Linux Wails .app
# bundle into a release-ready tarball + .deb. Called by the `build`
# matrix in .github/workflows/release.yml when matrix.target == wails-linux.
#
# Required inputs (env vars):
#   VERSION   — e.g. "v0.1.1" (with the leading 'v', as released by tag)
#
# Required inputs (paths, must already exist):
#   dist/linux/Recall                   — Linux Wails binary
#
# Outputs (in the current working directory):
#   recall-{V}-linux-amd64.tar.gz
#   recall-{V}-linux-amd64.deb
#
# `{V}` is VERSION with the leading 'v' stripped.

set -euo pipefail

if [ -z "${VERSION:-}" ]; then
  printf 'error: VERSION is required (e.g. VERSION=v0.1.1)\n' >&2
  exit 2
fi

PKG_VERSION="${VERSION#v}"

# ── Linux Wails app — tarball ─────────────────────────
mkdir -p "_tar/recall-${PKG_VERSION}-linux-amd64"
cp dist/linux/Recall "_tar/recall-${PKG_VERSION}-linux-amd64/recall"
tar -czf "recall-${PKG_VERSION}-linux-amd64.tar.gz" -C _tar "recall-${PKG_VERSION}-linux-amd64"

# ── Linux Wails app — .deb (installs to /usr/local/bin/recall) ──
mkdir -p _deb-recall/DEBIAN _deb-recall/usr/local/bin
cp dist/linux/Recall _deb-recall/usr/local/bin/recall
chmod 755 _deb-recall/usr/local/bin/recall
printf 'Package: recall\nVersion: %s\nArchitecture: amd64\nMaintainer: Jacob Delgado <jacob.delgado@gmail.com>\nDescription: Recall - Overwatch match history tracker\n Watches Overwatch screenshots, OCRs them with Tesseract, and tracks match history.\n' \
  "${PKG_VERSION}" >_deb-recall/DEBIAN/control
dpkg-deb --build _deb-recall "recall-${PKG_VERSION}-linux-amd64.deb"
