#!/usr/bin/env bash
# Test-skip drift gate.
#
# Greps every `t.Skip` / `t.Skipf` / `t.SkipNow` line under pkg/ and
# diffs the set against the checked-in allow-list at
# scripts/ci/test-skips-allow.txt. A new skip without an allow-list
# entry fails — flake-suppression skips are not allowed; document
# the gate or remove it.
#
# Same shape as scripts/ci/deadcode-check.sh. Called from lefthook
# pre-push and the CI workflow so a new skip can't slip through
# either path.

set -eu

allow=scripts/ci/test-skips-allow.txt
found=$(mktemp)
trap 'rm -f "$found"' EXIT

# Strip comments + blank lines from the allow-list so the diff is
# apples-to-apples with the grep output.
expected=$(mktemp)
trap 'rm -f "$found" "$expected"' EXIT
grep -vE '^\s*(#|$)' "$allow" | sort >"$expected"

grep -nrE 't\.Skip[fNow]*\(' pkg/ | sort >"$found"

if ! diff -u "$expected" "$found"; then
  echo
  echo "::error::Test-skip inventory drift."
  echo "Either justify the new skip in $allow with a one-line 'why'"
  echo "comment, or remove the t.Skip and fix the underlying test."
  echo "Flake-suppression skips are not allowed."
  exit 1
fi
