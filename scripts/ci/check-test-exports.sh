#!/usr/bin/env bash
#
# Find dead re-exports in export_test.go.
#
# WHY THIS EXISTS
#
# A package's export_test.go is the one sanctioned shim that lets an external
# `package foo_test` reach an unexported symbol. Every entry is a deliberate
# hole in the package boundary, and holes are supposed to close when the test
# that needed them goes away.
#
# Nothing made them close. `unused` does not reach exported identifiers in test
# files — an export is a public symbol as far as it is concerned — and the
# dead-code-go job skips test code entirely. So this class of dead weight had no
# gate at all, and seven entries accumulated behind it (TECHNICAL_DEBT.md
# section 19), two of them carrying doc comments that asserted a need no caller
# had for months.
#
# WHAT IT CHECKS
#
# For every exported identifier declared in a pkg/*/export_test.go, at least one
# OTHER _test.go file in the repo must name it. Same-file uses do not count: an
# entry that only feeds another entry in the same shim is still a hole nobody
# outside is using.
#
# LIMITS, stated rather than hidden: this is a grep, not a type checker. A
# symbol referenced only inside a string or a comment counts as used. That is
# the right way to be wrong here — the gate should never delete a live seam, and
# a false NEGATIVE just leaves one entry for review to catch.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

echo "[ recall ] Checking export_test.go for dead re-exports…"

shims="$(git ls-files 'pkg/**/export_test.go' 'pkg/*/export_test.go' | sort -u || true)"
[[ -n "${shims}" ]] || {
  echo "[ recall ] no export_test.go shims found"
  exit 0
}

# Every _test.go that is NOT a shim — the population allowed to justify an entry.
mapfile -t consumers < <(git ls-files '*_test.go' | grep -v '/export_test\.go$')

dead=0
while IFS= read -r shim; do
  [[ -n "${shim}" ]] || continue
  pkgdir="$(dirname "${shim}")"

  # Exported identifiers, in the three shapes these files actually use:
  #   grouped   `\tName = unexported`   (inside a var/const block)
  #   top-level `func Name(...)`
  #   top-level `var Name = ...` / `type Name ...`
  symbols="$(
    grep -hoE '^[[:space:]]+[A-Z][A-Za-z0-9_]*[[:space:]]*=|^func [A-Z][A-Za-z0-9_]*|^var [A-Z][A-Za-z0-9_]*|^type [A-Z][A-Za-z0-9_]*' "${shim}" \
      | sed -E 's/^[[:space:]]*//; s/^(func|var|type)[[:space:]]+//; s/[[:space:]]*=$//' \
      | sort -u || true
  )"

  # The shim with comment lines stripped, so a doc comment naming its own
  # symbol cannot pass for a use of it.
  body="$(grep -vE '^[[:space:]]*//' "${shim}" || true)"

  while IFS= read -r sym; do
    [[ -n "${sym}" ]] || continue

    # Used by a real test file? Done.
    if grep -qlE "\\b${sym}\\b" "${consumers[@]}" 2>/dev/null; then
      continue
    fi

    # Or load-bearing INSIDE the shim: a type named only as another entry's
    # parameter or return type is reached through that entry and never spelled
    # by the caller. LoadedMigration is exactly this — LoadMigrationsFrom
    # returns []LoadedMigration, and every caller uses the fields without
    # naming the type. Counting its declaration line only, it looked dead.
    if [[ "$(grep -cE "\\b${sym}\\b" <<<"${body}" || true)" -gt 1 ]]; then
      continue
    fi

    echo "::error file=${shim}::${sym} is re-exported for tests but no _test.go outside ${pkgdir}/export_test.go names it"
    dead=$((dead + 1))
  done <<<"${symbols}"
done <<<"${shims}"

if ((dead > 0)); then
  cat >&2 <<'EOF'

An export_test.go entry is a deliberate hole in a package boundary,
kept open for a test that no longer exists. Delete it.

If the symbol IS used and this is a false positive, the grep missed a
reference shape — say so in the PR rather than working around the gate.
EOF
  exit 1
fi

echo "[ recall ] ✓  every export_test.go entry has a caller"
