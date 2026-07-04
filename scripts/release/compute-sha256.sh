#!/usr/bin/env bash
# scripts/release/compute-sha256.sh — emit checksums for every release
# binary and package in the current directory:
#
#   1. `<file>.sha256` per artifact — one hash each, the format
#      `sha256sum --check` (or `shasum -a 256 --check` on macOS) consumes.
#   2. `SHA256SUMS` — one combined file, all artifacts. This is the asset
#      the in-app Wails updater reads (github provider `ChecksumAsset:
#      "SHA256SUMS"`, a compile-time constant → the name is load-bearing:
#      renaming it breaks every shipped client). It also serves manual
#      "verify your download" use.
#
# Called by release.yml's "Generate SHA256 checksums" step.
# No required env vars; operates on whatever recall-* artifacts the
# previous download-artifact step staged.

set -euo pipefail

# Collect the Windows release artifacts once: the installer + raw updater
# exe (both `recall-*.exe`), the reference-data YAMLs, and the reset-DB
# helper. The raw `…-windows-amd64.exe` is the in-app updater's swap target,
# so its hash MUST be in SHA256SUMS.
files=()
for f in \
  recall-*.exe recall-*.yaml recall-*.bat; do
  [ -f "$f" ] && files+=("$f")
done

for f in "${files[@]}"; do
  sha256sum "$f" >"${f}.sha256"
done

# Combined manifest — the updater's checksum source. Excludes the per-file
# .sha256 sidecars and itself by construction (files[] holds artifacts only).
sha256sum "${files[@]}" >SHA256SUMS
