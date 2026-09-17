#!/usr/bin/env bash
# scripts/release/check-release-assets.sh — refuse a release asset directory
# that lacks an asset every release ships, or holds anything else.
#
# release.yml's release job publishes every file in the directory the
# sign-attest job hands it, and a published release is immutable: an asset
# left out, or a stray file let in, stays that way. Two gaps matter most.
# Without its .sig an installed Recall refuses the update. Without a line
# for the exe under its bare name in SHA256SUMS, copies too old to check
# signatures install the update unverified.
#
# Usage: check-release-assets.sh DIR VERSION   (VERSION has no leading v)
#
# Required, where V is VERSION:
#   recall-V-windows-amd64.exe             the exe the updater swaps in
#   recall-V-windows-amd64-installer.exe   the download people install
#   the .sig of each, exactly 64 bytes
#   recall-V-Reset-Database.bat
#   recall-V-sbom.spdx.json
#   the .sha256 of each exe, of the .bat and of the SBOM
#   SHA256SUMS, naming recall-V-windows-amd64.exe without a directory
#   recall-V.intoto.jsonl, the provenance bundle: JSON lines, not empty
# Allowed besides: recall-V-<roster>.yaml with its .sha256, for each roster
# release.yml's staging step writes, since a roster YAML ships only in a
# release where it changed. Nothing else is allowed, hidden files and
# subdirectories included: a checksum and an attestation cover any YAML that
# reaches the directory, so a name no step stages must not pass as a roster.
#
# Exit 0 when the set is complete, 1 after naming every problem, 2 on a
# usage error.

set -euo pipefail

readonly SIGNATURE_BYTES=64
readonly ROSTERS=(heroes maps screenshot_sources seasons ranks patches)
PROBLEMS=0

usage_error() {
  printf 'error: %s\nusage: check-release-assets.sh DIR VERSION\n' "$1" >&2
  exit 2
}

problem() {
  printf '::error title=Release asset check::%s\n' "$1" >&2
  PROBLEMS=$((PROBLEMS + 1))
}

parse_args() {
  [ "$#" -eq 2 ] || usage_error "expected DIR and VERSION"
  DIR=$1
  VERSION=$2
  [ -n "$VERSION" ] || usage_error "VERSION is empty"
  [[ $VERSION != v* ]] || usage_error "VERSION takes no leading v: ${VERSION}"
  [ -d "$DIR" ] || usage_error "${DIR} is not a directory"
  EXE="recall-${VERSION}-windows-amd64.exe"
  INSTALLER="recall-${VERSION}-windows-amd64-installer.exe"
  BAT="recall-${VERSION}-Reset-Database.bat"
  BUNDLE="recall-${VERSION}.intoto.jsonl"
  SIGNATURES=("${EXE}.sig" "${INSTALLER}.sig")
  REQUIRED=("$EXE" "$INSTALLER" "${SIGNATURES[@]}" "$BAT"
    "recall-${VERSION}-sbom.spdx.json"
    "${EXE}.sha256" "${INSTALLER}.sha256" "${BAT}.sha256"
    "recall-${VERSION}-sbom.spdx.json.sha256" SHA256SUMS "$BUNDLE")
}

check_required() {
  local name
  for name in "${REQUIRED[@]}"; do
    [ -f "${DIR}/${name}" ] || problem "missing ${name}"
  done
}

check_signature_sizes() {
  local sig size
  for sig in "${SIGNATURES[@]}"; do
    [ -f "${DIR}/${sig}" ] || continue
    size=$(wc -c <"${DIR}/${sig}")
    size=${size//[[:space:]]/}
    [ "$size" -eq "$SIGNATURE_BYTES" ] \
      || problem "${sig} is ${size} bytes, not a ${SIGNATURE_BYTES}-byte signature"
  done
}

check_sums_name_exe() {
  local digest name
  [ -f "${DIR}/SHA256SUMS" ] || return 0
  while read -r digest name || [ -n "${digest:-}" ]; do
    if [[ ${name#\*} == "$EXE" && $digest =~ ^[0-9a-f]{64}$ ]]; then
      return 0
    fi
  done <"${DIR}/SHA256SUMS"
  problem "SHA256SUMS has no digest for ${EXE} under that bare name, the one the updater looks up"
}

check_bundle_shape() {
  local path="${DIR}/${BUNDLE}"
  [ -f "$path" ] || return 0
  if [ ! -s "$path" ]; then
    problem "${BUNDLE} is empty"
  elif [ "$(head -c 1 "$path")" != "{" ]; then
    problem "${BUNDLE} does not start with a JSON object"
  fi
}

is_required() { # <name>
  local want
  for want in "${REQUIRED[@]}"; do
    [ "$1" != "$want" ] || return 0
  done
  return 1
}

is_roster_yaml() { # <name>
  local roster
  for roster in "${ROSTERS[@]}"; do
    [ "$1" != "recall-${VERSION}-${roster}.yaml" ] || return 0
  done
  return 1
}

check_entry() { # <path>
  local name=${1##*/}
  if [ -d "$1" ] || [ ! -f "$1" ]; then
    problem "${name} is not a regular file; the directory holds release assets only"
  elif is_required "$name"; then
    return 0
  elif is_roster_yaml "$name"; then
    [ -f "${1}.sha256" ] || problem "${name} has no ${name}.sha256"
  elif [[ $name == *.sha256 ]] && is_roster_yaml "${name%.sha256}"; then
    [ -f "${1%.sha256}" ] || problem "${name} has no ${name%.sha256}"
  else
    problem "${name} is not a release asset"
  fi
}

check_entries() {
  local path
  while IFS= read -r -d '' path; do
    check_entry "$path"
  done < <(find "$DIR" -mindepth 1 -maxdepth 1 -print0)
}

main() {
  parse_args "$@"
  check_required
  check_signature_sizes
  check_sums_name_exe
  check_bundle_shape
  check_entries
  if [ "$PROBLEMS" -gt 0 ]; then
    printf '%d problem(s) with the release assets in %s\n' "$PROBLEMS" "$DIR" >&2
    exit 1
  fi
  printf 'Release assets complete for %s in %s\n' "$VERSION" "$DIR"
}

main "$@"
