#!/usr/bin/env bash
# scripts/release/smoke/smoke.sh — smoke-test scripts/release/*.sh without
# cutting a real tag. Each test case:
#   1. cd into a fresh per-case temp dir
#   2. stages the fixture filesystem the script under test expects
#   3. runs the script with stub env vars
#   4. asserts the expected output files exist (or, for input-validation
#      tests, that the script exits with the documented sentinel code).
#
# Why this exists: release.yml's `push: tags: v*` trigger means the only
# "real" way to validate an edit to a release script was a fresh tag —
# destructive iteration. With this test, contributors can edit the
# scripts and `task smoke-release-scripts` to know their changes survive
# the most common code paths in ~1s.
#
# Recall ships a Windows desktop app only, so the release scripts are
# package-wails-windows.sh (needs a real build tree, exercised in CI) and
# compute-sha256.sh (pure, smoke-tested here).

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
  # Plant one fake artifact of each shape the script's glob matches:
  # the installer exe, the raw updater exe, a reference YAML, the bat.
  printf 'a\n' >recall-0.0.0-smoke-windows-amd64-installer.exe
  printf 'b\n' >recall-0.0.0-smoke-windows-amd64.exe
  printf 'c\n' >recall-0.0.0-smoke-heroes.yaml
  printf 'd\n' >recall-0.0.0-smoke-Reset-Database.bat

  # Also a non-matching file — the glob must NOT pick it up.
  printf 'not-recall\n' >unrelated-file.exe

  if ! bash "${RELEASE_DIR}/compute-sha256.sh" >/dev/null 2>&1; then
    not_ok "compute-sha256.sh exited non-zero"
    return 0
  fi
  ok "compute-sha256.sh exited zero"

  local f
  for f in recall-0.0.0-smoke-windows-amd64-installer.exe \
    recall-0.0.0-smoke-windows-amd64.exe \
    recall-0.0.0-smoke-heroes.yaml \
    recall-0.0.0-smoke-Reset-Database.bat; do
    if [ -f "${f}.sha256" ]; then
      ok "compute-sha256.sh produced ${f}.sha256"
    else
      not_ok "compute-sha256.sh missing ${f}.sha256"
    fi
  done

  # The combined SHA256SUMS the in-app updater consumes must exist.
  if [ -f SHA256SUMS ]; then
    ok "compute-sha256.sh produced SHA256SUMS"
  else
    not_ok "compute-sha256.sh missing SHA256SUMS"
  fi

  if [ -f unrelated-file.exe.sha256 ]; then
    not_ok "compute-sha256.sh picked up unrelated-file.exe (glob too wide)"
  else
    ok "compute-sha256.sh leaves non-recall-* files alone"
  fi
}

# ── main ─────────────────────────────────────────────────────────────

main() {
  printf 'Smoke-testing scripts/release/*.sh\n'
  smoke_compute_sha256

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
