# shellcheck shell=bash
# Smoke cases for scripts/release/check-release-assets.sh. Sourced by
# ../smoke.sh, which sets RELEASE_DIR and REPO_ROOT and loads ../lib/_harness.sh.

readonly ASSETS_VERSION="0.34.0"
readonly ASSETS_EXE="recall-${ASSETS_VERSION}-windows-amd64.exe"
readonly ASSETS_INSTALLER="recall-${ASSETS_VERSION}-windows-amd64-installer.exe"
readonly ASSETS_BAT="recall-${ASSETS_VERSION}-Reset-Database.bat"
readonly ASSETS_SBOM="recall-${ASSETS_VERSION}-sbom.spdx.json"
readonly ASSETS_BUNDLE="recall-${ASSETS_VERSION}.intoto.jsonl"

check_assets() { # <arguments...>
  bash "${RELEASE_DIR}/check-release-assets.sh" "$@"
}

smoke_check_release_assets() {
  printf '\n# check-release-assets.sh\n'
  run_in_temp _assets_accepts "a complete asset set" true
  run_in_temp _assets_accepts "every roster YAML the staging step writes" \
    _plant_every_roster_yaml
  local name
  for name in "$ASSETS_EXE" "$ASSETS_INSTALLER" "${ASSETS_EXE}.sig" \
    "${ASSETS_INSTALLER}.sig" "$ASSETS_BAT" "$ASSETS_SBOM" \
    "${ASSETS_EXE}.sha256" "${ASSETS_INSTALLER}.sha256" "${ASSETS_BAT}.sha256" \
    "${ASSETS_SBOM}.sha256" SHA256SUMS "$ASSETS_BUNDLE"; do
    run_in_temp _assets_rejects "rejects a set without ${name}" "$name" \
      rm "release-assets/${name}"
  done
  run_in_temp _assets_rejects "rejects SHA256SUMS without the exe's line" \
    "SHA256SUMS" _drop_exe_from_sums
  run_in_temp _assets_rejects "rejects SHA256SUMS naming the exe with a directory" \
    "SHA256SUMS" _prefix_exe_in_sums
  run_in_temp _assets_rejects "rejects a 63-byte exe signature" \
    "${ASSETS_EXE}.sig" _write_bytes 63 "release-assets/${ASSETS_EXE}.sig"
  run_in_temp _assets_rejects "rejects a 65-byte installer signature" \
    "${ASSETS_INSTALLER}.sig" _write_bytes 65 "release-assets/${ASSETS_INSTALLER}.sig"
  run_in_temp _assets_rejects "rejects an empty provenance bundle" \
    "${ASSETS_BUNDLE} is empty" _write_bytes 0 "release-assets/${ASSETS_BUNDLE}"
  run_in_temp _assets_rejects "rejects a provenance bundle that is not JSON lines" \
    "${ASSETS_BUNDLE} does not start with a JSON object" \
    _write_bytes 64 "release-assets/${ASSETS_BUNDLE}"
  run_in_temp _assets_rejects "rejects a roster YAML without its checksum" \
    "recall-${ASSETS_VERSION}-heroes.yaml" _plant_yaml_without_checksum
  run_in_temp _assets_rejects "rejects a YAML the staging step never writes" \
    "recall-${ASSETS_VERSION}-evil.yaml is not a release asset" _plant_unknown_yaml
  run_in_temp _assets_rejects "rejects a subdirectory" "nested" \
    mkdir release-assets/nested
  run_in_temp _assets_rejects "rejects a file nothing expects" "update-signing" \
    touch release-assets/update-signing
  run_in_temp _assets_rejects "rejects a hidden file" ".stray" \
    touch release-assets/.stray
  run_case "exits 2 without VERSION" 2 "usage" check_assets release-assets
  run_case "exits 2 for a VERSION with a leading v" 2 "leading v" \
    check_assets . "v${ASSETS_VERSION}"
  run_case "exits 2 for a DIR that does not exist" 2 "not a directory" \
    check_assets missing "$ASSETS_VERSION"
}

_assets_accepts() { # <label> <edit command...>
  local label=$1
  shift
  _stage_release_assets
  "$@"
  run_case "accepts ${label}" 0 "" check_assets release-assets "$ASSETS_VERSION"
}

_assets_rejects() { # <label> <name the refusal must mention> <edit command...>
  local label=$1 want=$2
  shift 2
  _stage_release_assets
  "$@"
  run_case "$label" 1 "$want" check_assets release-assets "$ASSETS_VERSION"
}

# _stage_release_assets writes ./release-assets as sign-attest leaves it:
# every required asset, placeholder bytes throughout.
_stage_release_assets() {
  mkdir release-assets
  local name
  for name in "$ASSETS_EXE" "$ASSETS_INSTALLER" "$ASSETS_BAT" "$ASSETS_SBOM"; do
    printf '%s\n' "$name" >"release-assets/${name}"
  done
  _write_bytes 64 "release-assets/${ASSETS_EXE}.sig"
  _write_bytes 64 "release-assets/${ASSETS_INSTALLER}.sig"
  for name in "$ASSETS_EXE" "$ASSETS_INSTALLER" "$ASSETS_BAT" "$ASSETS_SBOM"; do
    _sum_line "$name" >"release-assets/${name}.sha256"
    _sum_line "$name" >>release-assets/SHA256SUMS
  done
  printf '{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json"}\n' \
    >"release-assets/${ASSETS_BUNDLE}"
}

_sum_line() { # <name>
  printf '%064d  %s\n' 0 "$1"
}

_write_bytes() { # <count> <path>
  head -c "$1" /dev/zero >"$2"
}

_plant_yaml_with_checksum() { # <roster>
  local name="recall-${ASSETS_VERSION}-${1}.yaml"
  printf '%s: []\n' "$1" >"release-assets/${name}"
  _sum_line "$name" >"release-assets/${name}.sha256"
}

_plant_every_roster_yaml() {
  local roster
  for roster in heroes maps screenshot_sources seasons ranks patches; do
    _plant_yaml_with_checksum "$roster"
  done
}

# A producer's manifest can vouch for a file beside its own, and
# compute-sha256.sh checksums any recall-*.yaml it finds, so a checksum
# alone does not make a YAML one this release stages.
_plant_unknown_yaml() {
  _plant_yaml_with_checksum evil
}

_plant_yaml_without_checksum() {
  printf 'heroes: []\n' >"release-assets/recall-${ASSETS_VERSION}-heroes.yaml"
}

_drop_exe_from_sums() {
  grep -vF "$ASSETS_EXE" release-assets/SHA256SUMS >release-assets/SHA256SUMS.new
  mv release-assets/SHA256SUMS.new release-assets/SHA256SUMS
}

# compute-sha256.sh run from outside the asset directory writes names like
# this, and the updater, which looks the exe up by its bare name, finds none.
_prefix_exe_in_sums() {
  _drop_exe_from_sums
  _sum_line "release-assets/${ASSETS_EXE}" >>release-assets/SHA256SUMS
}
