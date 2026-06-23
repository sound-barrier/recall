#!/usr/bin/env bash
# scripts/ci/govulncheck-retry.sh — run govulncheck, retrying ONLY on a transient
# vuln-DB fetch error. govulncheck downloads its vulnerability database from
# https://vuln.go.dev on every run, and that fetch occasionally times out on the
# CI runner (`dial tcp …: i/o timeout`), breaking an otherwise-green main with a
# finding-free failure. This retries just the fetch, in place.
#
# A real vulnerability finding — or ANY non-network failure — fails immediately:
# the retry only fires when the output matches a transient-network pattern, so a
# CVE is never masked by a retry.
#
# CI-only (govulncheck is a dedicated CI job, not wired into Taskfile/lefthook).
#
# Usage: bash scripts/ci/govulncheck-retry.sh ./...
#        bash scripts/ci/govulncheck-retry.sh -tags serveronly ./...

# NOTE: deliberately no `set -e` — we must capture govulncheck's non-zero exit to
# decide retry-vs-fail rather than abort on the first failure.
set -uo pipefail

readonly MAX_ATTEMPTS=3

# The ONLY failure class we retry: transient vuln.go.dev fetch errors. Anchored on
# govulncheck's own "fetching vulnerabilities" prefix plus the Go net stack's
# transient-error strings. Kept conservative — none of these phrases appear in a
# vulnerability finding, so a real CVE can never match and be retried away.
readonly TRANSIENT_RE='fetching vulnerabilities|i/o timeout|dial tcp|connection reset|TLS handshake timeout|context deadline exceeded|no such host|server misbehaving|unexpected EOF'

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  if output="$(govulncheck "$@" 2>&1)"; then
    printf '%s\n' "${output}"
    exit 0
  fi

  printf '%s\n' "${output}"

  if ! grep -qiE "${TRANSIENT_RE}" <<<"${output}"; then
    echo "[ govulncheck ] failure is not a transient vuln-DB fetch error — failing now" >&2
    exit 1
  fi

  if ((attempt < MAX_ATTEMPTS)); then
    backoff=$((attempt * 15))
    echo "::warning::govulncheck: transient vuln.go.dev fetch error (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${backoff}s" >&2
    sleep "${backoff}"
  fi
done

echo "::error::govulncheck: vuln.go.dev unreachable after ${MAX_ATTEMPTS} attempts" >&2
exit 1
