#!/usr/bin/env bash
# scripts/gen-goldens.sh — generate parser golden JSON for a screenshot file or
# a directory of screenshots, so you can eyeball exactly what the parser
# extracts (the screenshot_type + every field it populated) and spot bugs to
# report.
#
# Why this script exists: `make update-goldens` regenerates the committed
# testdata/ fixtures, but to *find* bugs you want to point the parser at an
# arbitrary capture — a single PNG, or a whole folder you just dropped
# screenshots into — without copying it into testdata/ first. This wraps the
# same golden-test machinery (RECALL_FIXTURE_DIR + RECALL_FIXTURE_UPDATE; see
# testdata/README.md) and handles the single-file case by isolating it so the
# parser doesn't touch the file's siblings.
#
# Usage:
#   scripts/gen-goldens.sh <file-or-directory>
#   make goldens SRC=<file-or-directory>
#
# Output: writes "<image>.golden.json" next to each .png/.jpg/.jpeg. Open it,
# compare against what the screenshot shows, and report any field that's wrong
# or missing. Re-runnable: existing goldens are overwritten in place.
#
# Requires: a Go toolchain and the Tesseract binary on PATH (the parser shells
# out to it). The golden test skips cleanly if Tesseract is absent.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT

err() {
  echo "[ gen-goldens ] $*" >&2
}

die() {
  err "$*"
  exit 1
}

# gen_dir regenerates goldens for every supported image in an absolute dir.
gen_dir() {
  local dir="$1"
  RECALL_FIXTURE_UPDATE=1 RECALL_FIXTURE_DIR="${dir}" \
    go test -C "${REPO_ROOT}" -run TestParseScreenshot_GoldenFiles ./pkg/parser/ >/dev/null
}

main() {
  if [[ $# -ne 1 || -z "$1" ]]; then
    die "usage: gen-goldens.sh <file-or-directory>"
  fi
  local target="$1"
  [[ -e "${target}" ]] || die "no such file or directory: ${target}"

  if [[ -d "${target}" ]]; then
    local abs
    abs="$(cd "${target}" && pwd)"
    echo "[ gen-goldens ] parsing every screenshot in ${abs}…"
    gen_dir "${abs}"
    echo "[ gen-goldens ] ✓  wrote *.golden.json next to each image in ${abs}"
    echo "[ gen-goldens ]    eyeball them against the screenshots and report anything wrong."
    return
  fi

  # Single file: copy it into a scratch dir so the parser regenerates only this
  # golden, then move the result back next to the original.
  local abs_dir abs base scratch
  abs_dir="$(cd "$(dirname "${target}")" && pwd)"
  base="$(basename "${target}")"
  abs="${abs_dir}/${base}"
  scratch="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand scratch now so the trap removes this dir.
  trap "rm -rf '${scratch}'" EXIT
  cp "${abs}" "${scratch}/"
  echo "[ gen-goldens ] parsing ${abs}…"
  gen_dir "${scratch}"
  cp "${scratch}/${base}.golden.json" "${abs}.golden.json"
  echo "[ gen-goldens ] ✓  wrote ${abs}.golden.json"
  echo "[ gen-goldens ]    eyeball it against the screenshot and report anything wrong."
}

main "$@"
