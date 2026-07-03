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
#   recall-{V}-linux-amd64          — raw binary the Wails updater swaps
#   recall-{V}-linux-amd64.tar.gz
#   recall-{V}-linux-amd64.deb
#
# `{V}` is VERSION with the leading 'v' stripped.
#
# The extension-less raw binary is the asset the in-app self-updater downloads
# and swaps in place. The .tar.gz is NOT usable for that: it nests the binary
# under a top-level directory (recall-{V}-linux-amd64/recall), and the Wails
# updater would rename that directory over the running binary path. Keep the
# tarball for humans; the raw binary is the updater target.

set -euo pipefail

if [ -z "${VERSION:-}" ]; then
  printf 'error: VERSION is required (e.g. VERSION=v0.1.1)\n' >&2
  exit 2
fi

PKG_VERSION="${VERSION#v}"

# ── Linux Wails app — raw binary (in-app updater target) ──
cp dist/linux/Recall "recall-${PKG_VERSION}-linux-amd64"
chmod 755 "recall-${PKG_VERSION}-linux-amd64"

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
