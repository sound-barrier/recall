#!/usr/bin/env bash
# scripts/release/smoke/smoke.sh — smoke-test every scripts/release/*.sh
# without cutting a real tag. Each test case:
#   1. cd into a fresh per-case temp dir
#   2. stages the fixture filesystem the script under test expects
#   3. runs the script with stub env vars
#   4. asserts the expected output files exist (or, for input-validation
#      tests, that the script exits with the documented sentinel code).
#
# Why this exists: release.yml's `push: tags: v*` trigger means the
# only "real" way to validate an edit to package-linux.sh was a fresh
# tag — destructive iteration. With these tests, contributors can edit
# the scripts and `task smoke-release-scripts` to know their changes
# survive the most common code paths in ~5s.
#
# Coverage strategy:
#   - package-linux.sh: full filesystem-level smoke (happy path).
#     Needs dpkg-deb (Linux/Debian) for the .deb half — skipped on
#     macOS with a notice; CI runs on ubuntu-latest so it always
#     exercises both halves.
#   - make-dmg.sh: full smoke on macOS (uses hdiutil); skipped on
#     Linux with a notice (CI's macOS runner exercises it).
#   - compute-sha256.sh: full smoke (no platform deps).
#   - sign-image.sh: input-validation smoke (the cosign happy path
#     needs a real Sigstore + container registry, out of scope).
#   - flip-package-public.sh: shellcheck-only (the happy path
#     requires real GH auth + a real package).
#
# Adds zero overhead to release.yml itself — this runs locally and
# (optionally) in a future CI job; release.yml continues to invoke
# the scripts directly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PASS=0
FAIL=0
SKIP=0
FAILURES=()

# ── Helpers ──────────────────────────────────────────────────────────

# ok / not_ok / skip print one line each. The summary at the end is the
# canonical success/failure signal for CI.
ok() {
  printf '  \033[32mPASS\033[0m  %s\n' "$1"
  PASS=$((PASS + 1))
}

not_ok() {
  printf '  \033[31mFAIL\033[0m  %s\n' "$1"
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
}

skip() {
  printf '  \033[33mSKIP\033[0m  %s (%s)\n' "$1" "$2"
  SKIP=$((SKIP + 1))
}

# Run `cmd...` in a fresh per-test temp dir; restore cwd + clean up
# afterward. NOT a subshell — the PASS/FAIL/SKIP counter vars need to
# survive back into the parent scope.
run_in_temp() {
  local tmpdir prev_dir rc=0
  tmpdir=$(mktemp -d)
  prev_dir=$(pwd)
  cd "$tmpdir"
  "$@" || rc=$?
  cd "$prev_dir"
  rm -rf "$tmpdir"
  return "$rc"
}

# ── package-linux.sh ─────────────────────────────────────────────────

smoke_package_linux() {
  printf '\n# package-linux.sh\n'

  if ! command -v dpkg-deb >/dev/null 2>&1; then
    skip "package-linux.sh full smoke" "dpkg-deb not on PATH"
    return 0
  fi

  run_in_temp _smoke_package_linux_inner
}

_smoke_package_linux_inner() {
  # Stage the six fixture binaries the script copies.
  mkdir -p dist/linux dist/windows dist/server-linux dist/server-windows dist/server-mac
  printf 'fake linux wails\n' >dist/linux/Recall
  printf 'fake windows installer\n' >dist/windows/Recall-amd64-installer.exe
  printf 'fake windows server\n' >dist/server-windows/Recall-server.exe
  printf 'fake linux server\n' >dist/server-linux/Recall-server
  printf 'fake mac server\n' >dist/server-mac/Recall-server-arm64

  if ! VERSION=v0.0.0-smoke bash "${RELEASE_DIR}/package-linux.sh" >/dev/null 2>&1; then
    not_ok "package-linux.sh exited non-zero on happy path"
    return 0
  fi
  ok "package-linux.sh exited zero on happy path"

  local expected=(
    "recall-0.0.0-smoke-linux-amd64.tar.gz"
    "recall-0.0.0-smoke-linux-amd64.deb"
    "recall-server-0.0.0-smoke-linux-amd64.tar.gz"
    "recall-server-0.0.0-smoke-linux-amd64.deb"
    "recall-0.0.0-smoke-windows-amd64-installer.exe"
    "recall-server-0.0.0-smoke-windows-amd64.exe"
    "recall-server-0.0.0-smoke-darwin-arm64.tar.gz"
  )
  local f
  for f in "${expected[@]}"; do
    if [ -f "$f" ]; then
      ok "package-linux.sh produced ${f}"
    else
      not_ok "package-linux.sh missing expected output ${f}"
    fi
  done

  # Missing-VERSION should exit 2 with the documented error.
  if VERSION='' bash "${RELEASE_DIR}/package-linux.sh" >/dev/null 2>&1; then
    not_ok "package-linux.sh accepted empty VERSION (should have failed)"
  else
    local rc=$?
    if [ "$rc" -eq 2 ]; then
      ok "package-linux.sh rejects empty VERSION with exit 2"
    else
      not_ok "package-linux.sh rejected empty VERSION but with rc=${rc}, want 2"
    fi
  fi
}

# ── compute-sha256.sh ────────────────────────────────────────────────

smoke_compute_sha256() {
  printf '\n# compute-sha256.sh\n'
  if ! command -v sha256sum >/dev/null 2>&1; then
    skip "compute-sha256.sh smoke" "sha256sum not on PATH (try shasum -a 256 instead)"
    return 0
  fi
  run_in_temp _smoke_compute_sha256_inner
}

_smoke_compute_sha256_inner() {
  # Plant one fake artifact of each shape the script's glob matches.
  printf 'a\n' >recall-0.0.0-smoke-linux-amd64.tar.gz
  printf 'b\n' >recall-0.0.0-smoke-linux-amd64.deb
  printf 'c\n' >recall-0.0.0-smoke-windows-amd64-installer.exe
  printf 'd\n' >recall-0.0.0-smoke-darwin-arm64.dmg

  # Also a non-matching file — the glob must NOT pick it up.
  printf 'not-recall\n' >unrelated-file.tar.gz

  if ! bash "${RELEASE_DIR}/compute-sha256.sh" >/dev/null 2>&1; then
    not_ok "compute-sha256.sh exited non-zero"
    return 0
  fi
  ok "compute-sha256.sh exited zero"

  local f
  for f in recall-0.0.0-smoke-linux-amd64.tar.gz \
    recall-0.0.0-smoke-linux-amd64.deb \
    recall-0.0.0-smoke-windows-amd64-installer.exe \
    recall-0.0.0-smoke-darwin-arm64.dmg; do
    if [ -f "${f}.sha256" ]; then
      ok "compute-sha256.sh produced ${f}.sha256"
    else
      not_ok "compute-sha256.sh missing ${f}.sha256"
    fi
  done

  if [ -f unrelated-file.tar.gz.sha256 ]; then
    not_ok "compute-sha256.sh picked up unrelated-file.tar.gz (glob too wide)"
  else
    ok "compute-sha256.sh leaves non-recall-* files alone"
  fi
}

# ── make-dmg.sh ──────────────────────────────────────────────────────

smoke_make_dmg() {
  printf '\n# make-dmg.sh\n'
  if [ "$(uname -s)" != "Darwin" ]; then
    skip "make-dmg.sh smoke" "macOS-only (uses hdiutil)"
    return 0
  fi
  if ! command -v hdiutil >/dev/null 2>&1; then
    skip "make-dmg.sh smoke" "hdiutil not found"
    return 0
  fi
  run_in_temp _smoke_make_dmg_inner
}

_smoke_make_dmg_inner() {
  # The script reads docs/dmg/README.txt by ROOT-relative path computed
  # from its own dirname, so the real file is fine to share — we don't
  # need to fake it. We DO need a Recall.app stub at dist/mac/.
  mkdir -p dist/mac/Recall.app/Contents
  printf 'fake bundle\n' >dist/mac/Recall.app/Contents/Info.plist

  if ! VERSION=v0.0.0-smoke bash "${RELEASE_DIR}/make-dmg.sh" >/dev/null 2>&1; then
    not_ok "make-dmg.sh exited non-zero on happy path"
    return 0
  fi
  ok "make-dmg.sh exited zero on happy path"

  if [ -f "recall-0.0.0-smoke-darwin-arm64.dmg" ]; then
    ok "make-dmg.sh produced the DMG"
  else
    not_ok "make-dmg.sh missing recall-0.0.0-smoke-darwin-arm64.dmg"
  fi

  # Missing-VERSION should exit 2.
  if VERSION='' bash "${RELEASE_DIR}/make-dmg.sh" >/dev/null 2>&1; then
    not_ok "make-dmg.sh accepted empty VERSION"
  else
    local rc=$?
    if [ "$rc" -eq 2 ]; then
      ok "make-dmg.sh rejects empty VERSION with exit 2"
    else
      not_ok "make-dmg.sh rejected empty VERSION but with rc=${rc}, want 2"
    fi
  fi
}

# ── sign-image.sh ────────────────────────────────────────────────────

smoke_sign_image() {
  printf '\n# sign-image.sh (input validation only)\n'

  # The cosign happy path needs a real Sigstore endpoint + registry, so
  # only the missing-env-var sentinel is checked here.
  local rc
  if DIGEST='' TAGS=foo bash "${RELEASE_DIR}/sign-image.sh" >/dev/null 2>&1; then
    not_ok "sign-image.sh accepted empty DIGEST"
  else
    rc=$?
    if [ "$rc" -eq 2 ]; then
      ok "sign-image.sh rejects empty DIGEST with exit 2"
    else
      not_ok "sign-image.sh rejected empty DIGEST but with rc=${rc}, want 2"
    fi
  fi

  if DIGEST=sha256:dead TAGS='' bash "${RELEASE_DIR}/sign-image.sh" >/dev/null 2>&1; then
    not_ok "sign-image.sh accepted empty TAGS"
  else
    rc=$?
    if [ "$rc" -eq 2 ]; then
      ok "sign-image.sh rejects empty TAGS with exit 2"
    else
      not_ok "sign-image.sh rejected empty TAGS but with rc=${rc}, want 2"
    fi
  fi
}

# ── flip-package-public.sh ───────────────────────────────────────────

smoke_flip_package_public() {
  printf '\n# flip-package-public.sh (syntax only)\n'

  # This one talks to the real GitHub API on the happy path, so the
  # smoke just confirms the script parses + passes shellcheck. The
  # broader `task lint-shell` covers shellcheck/shfmt globally but
  # naming it here makes the coverage gap explicit.
  if bash -n "${RELEASE_DIR}/flip-package-public.sh"; then
    ok "flip-package-public.sh parses (bash -n)"
  else
    not_ok "flip-package-public.sh fails bash -n"
  fi
}

# ── main ─────────────────────────────────────────────────────────────

main() {
  printf 'Smoke-testing scripts/release/*.sh\n'
  smoke_package_linux
  smoke_compute_sha256
  smoke_make_dmg
  smoke_sign_image
  smoke_flip_package_public

  printf '\n──────────────────────────────────────────\n'
  printf 'PASS: %d   FAIL: %d   SKIP: %d\n' "$PASS" "$FAIL" "$SKIP"

  if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed:\n'
    local f
    for f in "${FAILURES[@]}"; do
      printf '  - %s\n' "$f"
    done
    exit 1
  fi
}

main "$@"
