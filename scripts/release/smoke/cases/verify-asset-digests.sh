# shellcheck shell=bash
# Smoke cases for scripts/release/verify-asset-digests.sh. Sourced by
# ../smoke.sh, which sets RELEASE_DIR and REPO_ROOT and loads ../lib/_harness.sh.

readonly DIGESTS_EXE="recall-0.34.0-windows-amd64.exe"
readonly DIGESTS_INSTALLER="recall-0.34.0-windows-amd64-installer.exe"
readonly DIGESTS_SBOM="recall-0.34.0-sbom.spdx.json"

verify_digests() { # <arguments...>
  bash "${RELEASE_DIR}/verify-asset-digests.sh" "$@"
}

smoke_verify_asset_digests() {
  printf '\n# verify-asset-digests.sh\n'
  if ! command -v sha256sum >/dev/null 2>&1; then
    skip "verify-asset-digests.sh smoke" "sha256sum not on PATH"
    return 0
  fi
  run_in_temp _digests_accept_manifest
  run_in_temp _digests_accept_expected_names
  run_in_temp _digests_reject_tampered_byte
  run_in_temp _digests_reject_missing_file
  run_in_temp _digests_reject_extra_file
  run_in_temp _digests_reject_subdirectory
  run_in_temp _digests_reject_name_not_handed_off
  run_in_temp _digests_reject_expected_name_unlisted
  run_in_temp _digests_reject_manifest_as_name
  run_in_temp _digests_reject_malformed_line
  run_in_temp _digests_reject_directory_in_name
  run_in_temp _digests_reject_empty_manifest
  run_in_temp _digests_reject_duplicate_name
  run_case "exits 2 without a manifest" 2 "usage" verify_digests .
  run_case "exits 2 for a DIR that does not exist" 2 "not a directory" \
    verify_digests missing "$(printf '%064d  x\n' 0)"
}

# _stage_digest_assets writes the build's two files into ./build and leaves
# the manifest build-windows records for them in ./build.sums.
_stage_digest_assets() {
  mkdir build
  printf 'exe bytes\n' >"build/${DIGESTS_EXE}"
  printf 'installer bytes\n' >"build/${DIGESTS_INSTALLER}"
  (cd build && sha256sum -- "$DIGESTS_EXE" "$DIGESTS_INSTALLER") >build.sums
}

_digests_accept_manifest() {
  _stage_digest_assets
  run_case "accepts files that match their manifest" 0 "" \
    verify_digests build "$(<build.sums)"
}

_digests_accept_expected_names() {
  _stage_digest_assets
  run_case "accepts a manifest listing exactly the names its producer hands off" 0 "" \
    verify_digests build "$(<build.sums)" "$DIGESTS_EXE" "$DIGESTS_INSTALLER"
}

_digests_reject_tampered_byte() {
  _stage_digest_assets
  printf 'exe bytez\n' >"build/${DIGESTS_EXE}"
  run_case "rejects a file with one byte changed" 1 "$DIGESTS_EXE" \
    verify_digests build "$(<build.sums)"
}

_digests_reject_missing_file() {
  _stage_digest_assets
  rm "build/${DIGESTS_INSTALLER}"
  run_case "rejects a listed file that is missing" 1 "$DIGESTS_INSTALLER" \
    verify_digests build "$(<build.sums)"
}

_digests_reject_extra_file() {
  _stage_digest_assets
  printf 'evil\n' >build/recall-0.34.0-evil.yaml
  run_case "rejects a file the manifest does not list" 1 "recall-0.34.0-evil.yaml" \
    verify_digests build "$(<build.sums)"
}

_digests_reject_subdirectory() {
  _stage_digest_assets
  mkdir build/nested
  run_case "rejects a subdirectory" 1 "nested" \
    verify_digests build "$(<build.sums)"
}

# The sbom job runs third-party code before it records its manifest, which
# can then vouch for a file beside the SBOM with a digest that matches.
_digests_reject_name_not_handed_off() {
  mkdir sbom
  printf 'sbom bytes\n' >"sbom/${DIGESTS_SBOM}"
  printf 'heroes: [evil]\n' >sbom/recall-0.34.0-heroes.yaml
  (cd sbom && sha256sum -- "$DIGESTS_SBOM" recall-0.34.0-heroes.yaml) >sbom.sums
  run_case "rejects a manifest listing a file its producer does not hand off" 1 \
    "recall-0.34.0-heroes.yaml" \
    verify_digests sbom "$(<sbom.sums)" "$DIGESTS_SBOM"
}

_digests_reject_expected_name_unlisted() {
  _stage_digest_assets
  rm "build/${DIGESTS_INSTALLER}"
  (cd build && sha256sum -- "$DIGESTS_EXE") >build.sums
  run_case "rejects a manifest that omits a name its producer hands off" 1 \
    "$DIGESTS_INSTALLER" \
    verify_digests build "$(<build.sums)" "$DIGESTS_EXE" "$DIGESTS_INSTALLER"
}

# Two producers' manifests in one call would let either vouch for the
# other's files; a second manifest must not pass as a NAME.
_digests_reject_manifest_as_name() {
  _stage_digest_assets
  run_case "exits 2 for a NAME that is not a bare file name" 2 "bare file name" \
    verify_digests build "$(<build.sums)" "$(<build.sums)"
}

_digests_reject_malformed_line() {
  _stage_digest_assets
  run_case "exits 2 for a manifest line that is not a digest and a name" 2 "malformed" \
    verify_digests build "not-a-digest  ${DIGESTS_EXE}"
}

# A name with a directory could point outside the checked directory, and is
# never what a producer that hashes in place records.
_digests_reject_directory_in_name() {
  _stage_digest_assets
  run_case "exits 2 for a manifest name with a directory" 2 "malformed" \
    verify_digests build "$(cut -d' ' -f1 build.sums | head -n 1)  build/${DIGESTS_EXE}"
}

# An output name typed wrong in the workflow expands to nothing; that must
# not read as "nothing to check".
_digests_reject_empty_manifest() {
  _stage_digest_assets
  run_case "exits 2 for an empty manifest" 2 "no digests" \
    verify_digests build ""
}

_digests_reject_duplicate_name() {
  _stage_digest_assets
  run_case "exits 2 for a file listed twice" 2 "more than once" \
    verify_digests build "$(<build.sums)"$'\n'"$(<build.sums)"
}
