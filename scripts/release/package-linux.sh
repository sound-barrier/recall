#!/usr/bin/env bash
# scripts/release/package-linux.sh — package Linux + Windows + macOS-server
# artifacts produced by Dockerfile.build into the release-ready filenames
# the .github/workflows/release.yml "Package artifacts" step previously
# inlined. Extracted into a script so the packaging logic can be lint-
# checked, smoke-tested locally with `VERSION=v0.0.0 ./scripts/release/
# package-linux.sh`, and read without scrolling the workflow YAML.
#
# Required inputs (env vars):
#   VERSION   — e.g. "v0.1.1" (with the leading 'v', as released by tag)
#
# Required inputs (paths, must already exist):
#   dist/linux/Recall                   — Linux Wails binary
#   dist/windows/Recall-amd64-installer.exe
#   dist/windows/Recall-server.exe      — well, see Note below
#   dist/server-linux/Recall-server
#   dist/server-windows/Recall-server.exe
#   dist/server-mac/Recall-server-arm64
#
# Outputs (in the current working directory):
#   recall-{V}-linux-amd64.tar.gz
#   recall-{V}-linux-amd64.deb
#   recall-server-{V}-linux-amd64.tar.gz
#   recall-server-{V}-linux-amd64.deb
#   recall-{V}-windows-amd64-installer.exe
#   recall-server-{V}-windows-amd64.exe
#   recall-server-{V}-darwin-arm64.tar.gz
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

# ── Linux server binary — tarball ─────────────────────
mkdir -p "_tar/recall-server-${PKG_VERSION}-linux-amd64"
cp dist/server-linux/Recall-server "_tar/recall-server-${PKG_VERSION}-linux-amd64/recall-server"
tar -czf "recall-server-${PKG_VERSION}-linux-amd64.tar.gz" -C _tar "recall-server-${PKG_VERSION}-linux-amd64"

# ── Linux server binary — .deb (installs to /usr/local/bin/recall-server) ──
mkdir -p _deb-server/DEBIAN _deb-server/usr/local/bin
cp dist/server-linux/Recall-server _deb-server/usr/local/bin/recall-server
chmod 755 _deb-server/usr/local/bin/recall-server
printf 'Package: recall-server\nVersion: %s\nArchitecture: amd64\nMaintainer: Jacob Delgado <jacob.delgado@gmail.com>\nDescription: Recall server - Overwatch match history HTTP server\n Headless HTTP server that serves match history data and optional Prometheus metrics.\n' \
  "${PKG_VERSION}" >_deb-server/DEBIAN/control
dpkg-deb --build _deb-server "recall-server-${PKG_VERSION}-linux-amd64.deb"

# ── Windows artifacts ─────────────────────────────────
# Desktop: NSIS installer (replaces bare exe as the primary artifact).
cp dist/windows/Recall-amd64-installer.exe "recall-${PKG_VERSION}-windows-amd64-installer.exe"
cp dist/server-windows/Recall-server.exe "recall-server-${PKG_VERSION}-windows-amd64.exe"

# ── macOS server binary — tarball ─────────────────────
mkdir -p "_tar/recall-server-${PKG_VERSION}-darwin-arm64"
cp dist/server-mac/Recall-server-arm64 "_tar/recall-server-${PKG_VERSION}-darwin-arm64/recall-server"
tar -czf "recall-server-${PKG_VERSION}-darwin-arm64.tar.gz" -C _tar "recall-server-${PKG_VERSION}-darwin-arm64"
