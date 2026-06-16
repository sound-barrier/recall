#!/usr/bin/env bash
# scripts/ci/deadcode-check.sh — run `deadcode` against the serveronly build
# tag and fail iff the output contains anything not matched by
# scripts/ci/deadcode-allow.txt.
#
# Why this script exists: deadcode itself always exits 0 regardless of
# findings, and the project has a small fixed set of intentional
# unreachables (build-tag stubs, test-only constructors) that must be
# filtered out. Centralising the allow-list and the gating logic here
# means the Taskfile, lefthook, and CI all invoke the same check —
# previously each carried its own copy of the filter regex and they
# drifted at least once.
#
# Usage: bash scripts/ci/deadcode-check.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOW_FILE="${SCRIPT_DIR}/deadcode-allow.txt"

if [ ! -f "${ALLOW_FILE}" ]; then
  printf 'error: allow-list not found at %s\n' "${ALLOW_FILE}" >&2
  exit 1
fi

# Strip comments + blank lines, leaving one regex fragment per line.
# Errors out if the result is empty (which would silently pass
# everything as "expected").
ALLOW_PATTERNS=$(grep -vE '^[[:space:]]*(#|$)' "${ALLOW_FILE}" || true)
if [ -z "${ALLOW_PATTERNS}" ]; then
  printf 'error: %s has no active patterns\n' "${ALLOW_FILE}" >&2
  exit 1
fi

# The Go module root overlaps with frontend/node_modules/flatted/golang,
# which ships real .go files that `go list ./...` picks up but no Go
# tool can actually load. Filter them out before handing to deadcode.
pkgs=$(go list -tags serveronly ./... | grep -v node_modules)

# deadcode exits 0 regardless of findings; capture stdout and gate on
# whether the residual (after allow-list filtering) is empty.
# shellcheck disable=SC2086  # $pkgs is space-separated; word-split is intentional.
out=$(deadcode -tags serveronly $pkgs)

if [ -z "${out}" ]; then
  exit 0
fi

# Echo the raw findings so a contributor can see what the allow-list
# is letting through, then compute the residual.
printf '%s\n' "${out}"

unexpected=$(printf '%s\n' "${out}" | grep -vE "${ALLOW_PATTERNS//$'\n'/|}" || true)

if [ -n "${unexpected}" ]; then
  printf '\nUnexpected dead Go code (not covered by %s):\n%s\n' \
    "${ALLOW_FILE}" "${unexpected}" >&2
  exit 1
fi
