#!/usr/bin/env bash
# scripts/release/compute-sha256.sh — emit a `<file>.sha256` for every
# release binary and package in the current directory. Each .sha256
# contains the SHA256 hash of exactly one artifact, in the same format
# `sha256sum --check` (or `shasum -a 256 --check` on macOS) consumes.
#
# Called by release.yml's "Generate SHA256 checksums" step.
# No required env vars; operates on whatever recall-* artifacts the
# previous download-artifact step staged.

set -euo pipefail

for f in recall-*.tar.gz recall-*.deb recall-*.exe recall-*.dmg recall-*.yaml recall-*.bat; do
  [ -f "$f" ] && sha256sum "$f" >"${f}.sha256"
done
