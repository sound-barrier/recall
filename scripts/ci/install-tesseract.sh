#!/usr/bin/env bash
# Install the goldens' baseline Tesseract on a CI runner, loud-failing on
# major.minor drift.
#
# The golden corpus (and the parser behavior Startup checks) are baselined
# against TESSERACT_VERSION in mise.toml [env] — 5.5.x, the maintainer's
# local build. ubuntu's stock tesseract-ocr package tracks 5.3.x, whose OCR
# output drifts enough to flip a quarter of the corpus, so the install comes
# from the alex-p PPA (tracks current upstream). The guard makes version
# drift name itself instead of masquerading as golden mismatches: an
# INTENTIONAL baseline bump means re-baseline testdata/*.golden.json and
# bump the mise.toml pin together.
#
# Consumers: ci.yml (schemathesis job) + golden-corpus.yml. TESSERACT_VERSION
# arrives via mise-action's $GITHUB_ENV export; the mise.toml grep is the
# fallback for callers without it.
set -euo pipefail

# Retry a network step. add-apt-repository talks to Launchpad, apt-get talks
# to the mirrors, and both answer for themselves: a Launchpad 500
# ("GPGKeyTemporarilyNotFoundError") took a dependabot PR's whole CI red for
# an outage that was over by the time anyone looked. Three tries with a
# widening gap turns that minute into a non-event; a genuinely broken source
# still fails, just three times slower.
retry() {
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then
      return 0
    fi
    if [ "$attempt" -lt 3 ]; then
      echo "::warning::'$*' failed (attempt $attempt/3) — retrying in $((attempt * 15))s"
      sleep "$((attempt * 15))"
    fi
  done
  echo "::error::'$*' failed three times — the package source is down or wrong, not flaky."
  return 1
}

pin="${TESSERACT_VERSION:-$(grep -E '^TESSERACT_VERSION' mise.toml | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)}"
expected_mm=$(printf '%s' "$pin" | cut -d. -f1-2)

retry sudo add-apt-repository -y ppa:alex-p/tesseract-ocr5
retry sudo apt-get update -y
retry sudo apt-get install -y --no-install-recommends tesseract-ocr

installed=$(tesseract --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
installed_mm=$(printf '%s' "$installed" | cut -d. -f1-2)
if [ "$installed_mm" != "$expected_mm" ]; then
  echo "::error::Tesseract major.minor mismatch: installed=$installed_mm expected=$expected_mm (TESSERACT_VERSION=$pin in mise.toml). Fix the install source, or re-baseline testdata/*.golden.json + bump the pin."
  exit 1
fi
echo "Tesseract $installed matches pinned major.minor $expected_mm"
