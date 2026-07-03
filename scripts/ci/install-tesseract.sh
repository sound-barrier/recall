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

pin="${TESSERACT_VERSION:-$(grep -E '^TESSERACT_VERSION' mise.toml | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)}"
expected_mm=$(printf '%s' "$pin" | cut -d. -f1-2)

sudo add-apt-repository -y ppa:alex-p/tesseract-ocr5
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends tesseract-ocr

installed=$(tesseract --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
installed_mm=$(printf '%s' "$installed" | cut -d. -f1-2)
if [ "$installed_mm" != "$expected_mm" ]; then
  echo "::error::Tesseract major.minor mismatch: installed=$installed_mm expected=$expected_mm (TESSERACT_VERSION=$pin in mise.toml). Fix the install source, or re-baseline testdata/*.golden.json + bump the pin."
  exit 1
fi
echo "Tesseract $installed matches pinned major.minor $expected_mm"
