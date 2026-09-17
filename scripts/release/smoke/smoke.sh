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
# the most common code paths in seconds.
#
# Recall ships a Windows desktop app only. package-wails-windows.sh needs a
# real build tree and is exercised by CI's build job; every other release
# script is smoke-tested here. The ref guards run against scratch git
# repositories: a bare origin plus a clone, built per case.
#
# Layout: this file is the runner. lib/_harness.sh holds the PASS/FAIL/SKIP
# accounting, run_case and the scratch-repository and gh-stub fixtures;
# cases/<script>.sh holds the cases for scripts/release/<script>.sh. A
# script that gains cases gets them in its own file, not in this one.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${RELEASE_DIR}/../.." && pwd)"

# shellcheck source=lib/_harness.sh
. "${SCRIPT_DIR}/lib/_harness.sh"
# shellcheck source=cases/compute-sha256.sh
. "${SCRIPT_DIR}/cases/compute-sha256.sh"
# shellcheck source=cases/verify-release-ref.sh
. "${SCRIPT_DIR}/cases/verify-release-ref.sh"
# shellcheck source=cases/push-release-tag.sh
. "${SCRIPT_DIR}/cases/push-release-tag.sh"
# shellcheck source=cases/fire-release.sh
. "${SCRIPT_DIR}/cases/fire-release.sh"
# shellcheck source=cases/check-release-assets.sh
. "${SCRIPT_DIR}/cases/check-release-assets.sh"
# shellcheck source=cases/verify-asset-digests.sh
. "${SCRIPT_DIR}/cases/verify-asset-digests.sh"

main() {
  printf 'Smoke-testing scripts/release/*.sh\n'
  isolate_git
  smoke_compute_sha256
  smoke_verify_release_ref
  smoke_push_release_tag
  smoke_fire_release
  smoke_check_release_assets
  smoke_verify_asset_digests
  report_results
}

main "$@"
