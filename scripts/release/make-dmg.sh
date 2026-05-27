#!/usr/bin/env bash
# scripts/release/make-dmg.sh — wrap the macOS Wails .app bundle into a
# distributable DMG. Called by .github/workflows/release.yml's "Create
# DMG" step. macOS-only (uses hdiutil).
#
# DMG layout (what the user sees when they double-click the .dmg):
#
#     Recall          — the .app bundle (no -arm64 suffix — the DMG
#                       filename already carries the arch)
#     Applications →  — symlink to /Applications so the user can
#                       drag-install in one motion
#     README.txt      — drag-install steps + Gatekeeper approval (the
#                       binary isn't notarized and macOS 15+ removed
#                       the old right-click-Open bypass).
#                       Source: docs/dmg/README.txt — edit there, then
#                       review docs/install-macos.md sections 2-3 which
#                       mirror the same content for the web.
#
# Required inputs (env vars):
#   VERSION   — e.g. "v0.1.1"
#
# Required inputs (paths, must already exist):
#   dist/mac/Recall.app
#   docs/dmg/README.txt
#
# Output (in cwd):
#   recall-{V}-darwin-arm64.dmg   (V = VERSION minus leading 'v')

set -euo pipefail

if [ -z "${VERSION:-}" ]; then
  printf 'error: VERSION is required (e.g. VERSION=v0.1.1)\n' >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PKG_VERSION="${VERSION#v}"

mkdir -p dmg-staging
cp -R dist/mac/Recall.app dmg-staging/
ln -s /Applications dmg-staging/Applications
cp "${ROOT}/docs/dmg/README.txt" dmg-staging/README.txt

DMG_NAME="recall-${PKG_VERSION}-darwin-arm64.dmg"

# hdiutil flakes intermittently on the macos-latest runner with
# "hdiutil: create failed - Resource busy" — usually because Spotlight
# / fseventsd is still scanning dmg-staging when hdiutil tries to take
# an exclusive lock on the source folder, or because a prior
# /Volumes/Recall mount from a stuck previous run hasn't been
# released. Retry with a short backoff and force-detach the volume
# name between attempts.
attempts=3
delay=5
for attempt in $(seq 1 $attempts); do
  # Best-effort detach in case /Volumes/Recall is lingering from a
  # previous attempt or a stuck runner. `|| true` swallows the
  # expected "no such volume" exit on the first try.
  hdiutil detach -force "/Volumes/Recall" >/dev/null 2>&1 || true

  if hdiutil create -volname "Recall" \
    -srcfolder dmg-staging \
    -ov -format UDZO \
    "${DMG_NAME}"; then
    exit 0
  fi

  if [ "$attempt" -lt "$attempts" ]; then
    printf 'hdiutil create failed (attempt %d/%d); sleeping %ds before retry...\n' \
      "$attempt" "$attempts" "$delay" >&2
    sleep "$delay"
  fi
done

printf 'hdiutil create failed after %d attempts\n' "$attempts" >&2
exit 1
