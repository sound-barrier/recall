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

# The PPA is added by hand, not with add-apt-repository. add-apt-repository
# asks Launchpad's API (api.launchpad.net) for the signing key on every run,
# and that API is a single point of failure the packages do not need: a 500
# from it ("GPGKeyTemporarilyNotFoundError") once took a Dependabot PR's CI
# red, and on 2026-11-11 the runners could not resolve its name at all, which
# failed roster-watch and the golden corpus together. The key is committed
# instead (tesseract-ppa-keyring.gpg beside this script) and checked against
# PPA_KEY_FINGERPRINT before apt trusts it, so the only host left is the one
# that serves the packages, ppa.launchpadcontent.net.
#
# Rotating the key: if Launchpad re-keys the PPA, apt-get update fails with
# NO_PUBKEY naming the new key. Fetch it from keyserver.ubuntu.com, check its
# fingerprint against the PPA's signing_key_fingerprint on Launchpad's API
# and that `gpgv --keyring` verifies the PPA's dists/<codename>/InRelease,
# then replace the keyring and the fingerprint below in one commit.

# Retry a network step. apt-get talks to the mirrors and the PPA host, which
# have outages of their own; three tries with a widening gap turns a minute
# of trouble into a non-event, and a genuinely broken source still fails,
# just three times slower.
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

PPA_KEY_FINGERPRINT="03645B99FA4163FE8C2508BC3A788ED11EFFCAF9"
PPA_KEYRING="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tesseract-ppa-keyring.gpg"

# add_ppa trusts the committed key for this one source and nothing else
# (Signed-By), after checking it is still the key the fingerprint names.
add_ppa() {
  local actual codename
  actual=$(gpg --show-keys --with-colons "$PPA_KEYRING" | awk -F: '$1 == "fpr" { print $10; exit }')
  if [ "$actual" != "$PPA_KEY_FINGERPRINT" ]; then
    echo "::error::$PPA_KEYRING has fingerprint '$actual', expected $PPA_KEY_FINGERPRINT. See the rotation note at the top of this script."
    exit 1
  fi
  # shellcheck source=/dev/null
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  sudo install -m 0644 "$PPA_KEYRING" /usr/share/keyrings/alex-p-tesseract-ocr5.gpg
  sudo tee /etc/apt/sources.list.d/alex-p-tesseract-ocr5.sources >/dev/null <<SOURCES
Types: deb
URIs: https://ppa.launchpadcontent.net/alex-p/tesseract-ocr5/ubuntu
Suites: $codename
Components: main
Signed-By: /usr/share/keyrings/alex-p-tesseract-ocr5.gpg
SOURCES
}

pin="${TESSERACT_VERSION:-$(grep -E '^TESSERACT_VERSION' mise.toml | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)}"
expected_mm=$(printf '%s' "$pin" | cut -d. -f1-2)

add_ppa
retry sudo apt-get update -y
retry sudo apt-get install -y --no-install-recommends tesseract-ocr

installed=$(tesseract --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
installed_mm=$(printf '%s' "$installed" | cut -d. -f1-2)
if [ "$installed_mm" != "$expected_mm" ]; then
  echo "::error::Tesseract major.minor mismatch: installed=$installed_mm expected=$expected_mm (TESSERACT_VERSION=$pin in mise.toml). Fix the install source, or re-baseline testdata/*.golden.json + bump the pin."
  exit 1
fi
echo "Tesseract $installed matches pinned major.minor $expected_mm"
