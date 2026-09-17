#!/usr/bin/env bash
# Decide whether a change set needs the Playwright suite. Reads changed paths,
# one per line, on stdin and prints `relevant=true` or `relevant=false` to
# stdout, ready to append to $GITHUB_OUTPUT. e2e.yml's detect step is the
# caller.
#
# FAIL CLOSED. The suite runs unless EVERY changed path is on the safe list
# below. The detector this replaces listed the paths that DID matter
# (frontend/, pkg/, *.go, the spec) and skipped everything else, so each input
# nobody remembered skipped the suite: go.mod/go.sum (a Dependabot Go bump,
# #748, went green without Playwright), .node-version (the Node that builds
# the bundle and runs the tests) and testdata/ (_real-server.ts stages a golden
# screenshot for the real-OCR specs). An empty list also runs the suite: a
# diff that listed nothing proves nothing.
#
# Why each safe entry is safe. Nothing in the e2e build or harness reads it:
# the Vite build reads only frontend/, the serveronly binary embeds nothing
# outside frontend/dist and pkg/, and the specs read only testdata/.
#   docs/ book/ .claude/            prose and the Pages site
#   top-level *.md, LICENSE, NOTICE project documents
#   .github/ISSUE_TEMPLATE/, CODEOWNERS, dependabot.yml, labels.yml,
#   pull_request_template.md        GitHub metadata, not workflows or actions
#   .release-please-manifest.json   GetVersion reads it only in a binary built
#                                   without -ldflags, from the server's cwd
#                                   (frontend/ under Playwright, where it is
#                                   absent), and every version-asserting spec
#                                   mocks /api/v1/system/version. A spec that
#                                   reads the real version must drop this entry.
# testdata/ must never join the list.
#
# Callers must pass --no-renames. With rename detection on (git's default), a
# rename lists only its new path, so a file moved from frontend/ into docs/
# would read as a docs-only change and skip the suite.
#
# Usage: git diff --no-renames --name-only BASE..HEAD | bash scripts/ci/e2e-relevant-changes.sh

set -euo pipefail

readonly SAFE='^(docs/|book/|\.claude/|\.github/ISSUE_TEMPLATE/|[^/]+\.md$|LICENSE$|NOTICE$|\.release-please-manifest\.json$|\.github/(CODEOWNERS|dependabot\.yml|labels\.yml|pull_request_template\.md)$)'

paths="$(grep -v '^[[:space:]]*$' || true)"

if [[ -z "${paths}" ]]; then
  echo "e2e-relevant-changes: no changed paths, running Playwright (fail closed)" >&2
  echo "relevant=true"
  exit 0
fi

grep_status=0
first_relevant="$(grep -vE -m1 "${SAFE}" <<<"${paths}")" || grep_status=$?
if ((grep_status > 1)); then
  echo "e2e-relevant-changes: grep failed (exit ${grep_status}), running Playwright (fail closed)" >&2
  echo "relevant=true"
  exit 0
fi
if [[ -n "${first_relevant}" ]]; then
  echo "e2e-relevant-changes: ${first_relevant} is not on the safe list, running Playwright" >&2
  echo "relevant=true"
  exit 0
fi

echo "relevant=false"
