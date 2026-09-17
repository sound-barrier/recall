#!/usr/bin/env bash
# scripts/release/verify-asset-digests.sh — refuse a downloaded artifact
# directory unless it holds exactly the files its producing job recorded,
# byte for byte.
#
# release.yml hands files from job to job as artifacts, looked up by name.
# Code holding the run's artifact token can delete an artifact and upload
# another under that name, and sign-attest may wait days for approval. So
# each producing job records the SHA-256 of every file it uploads as a job
# output, which is kept apart from the artifacts, and the consuming job runs
# this before it uses a downloaded byte.
#
# Usage: verify-asset-digests.sh DIR MANIFEST [NAME...]
#
# MANIFEST is one producer's `sha256sum` output: a line per file, the hex
# digest, two spaces (or a space and `*`) and the file's bare name. DIR must
# hold every listed file with that digest and nothing else: no unlisted
# file, hidden or not, and no subdirectory. One producer, one directory, one
# call, so a producer cannot vouch for another's files.
#
# Each NAME, when any is given, is a file the producer hands off, and the
# manifest must list every NAME and nothing else. A digest proves only that
# the bytes are what the producer recorded; a producer that runs third-party
# code can record a file beside its own, and with no NAME that file passes.
#
# Exit 0 when the directory matches, 1 after naming every file that does
# not, 2 on a usage error or a malformed manifest: an empty one, a line that
# is not a digest and a bare name, or a name listed twice.

set -euo pipefail

NAMES=()
DIGESTS=()
EXPECTED=()
PROBLEMS=0

usage_error() {
  printf 'error: %s\nusage: verify-asset-digests.sh DIR MANIFEST [NAME...]\n' "$1" >&2
  exit 2
}

problem() {
  printf '::error title=Artifact digest check::%s\n' "$1" >&2
  PROBLEMS=$((PROBLEMS + 1))
}

contains() { # <needle> <haystack...>
  local needle=$1 item
  shift
  for item in "$@"; do
    [ "$needle" != "$item" ] || return 0
  done
  return 1
}

is_listed() { # <name>
  contains "$1" "${NAMES[@]}"
}

read_manifest() { # <manifest>
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    [[ $line =~ ^([0-9a-f]{64})\ [\ *]([^/]+)$ ]] \
      || usage_error "manifest is malformed at: ${line}"
    ! is_listed "${BASH_REMATCH[2]}" \
      || usage_error "manifest lists ${BASH_REMATCH[2]} more than once"
    NAMES+=("${BASH_REMATCH[2]}")
    DIGESTS+=("${BASH_REMATCH[1]}")
  done <<<"$1"
  [ "${#NAMES[@]}" -gt 0 ] \
    || usage_error "manifest has no digests; its producer's output did not arrive"
}

check_expected_are_bare_names() {
  local name
  for name in "${EXPECTED[@]}"; do
    [[ $name =~ ^[^/[:space:]]+$ ]] \
      || usage_error "NAME is not a bare file name: ${name}"
  done
}

check_manifest_names() {
  [ "${#EXPECTED[@]}" -gt 0 ] || return 0
  local name
  for name in "${EXPECTED[@]}"; do
    is_listed "$name" || problem "the manifest does not list ${name}"
  done
  for name in "${NAMES[@]}"; do
    contains "$name" "${EXPECTED[@]}" \
      || problem "the manifest lists ${name}, which its producer does not hand off"
  done
}

check_listed_files() {
  local i name actual
  for i in "${!NAMES[@]}"; do
    name=${NAMES[i]}
    if [ ! -f "${DIR}/${name}" ]; then
      problem "${name} is missing"
      continue
    fi
    actual=$(sha256sum -- "${DIR}/${name}" | cut -d' ' -f1)
    [ "$actual" = "${DIGESTS[i]}" ] \
      || problem "${name} does not match the digest its producer recorded"
  done
}

check_unlisted_entries() {
  local path name
  while IFS= read -r -d '' path; do
    name=${path##*/}
    if [ -d "$path" ]; then
      problem "${name} is a subdirectory no producer uploaded"
    elif ! is_listed "$name"; then
      problem "${name} is not a file the producer recorded"
    fi
  done < <(find "$DIR" -mindepth 1 -maxdepth 1 -print0)
}

main() {
  [ "$#" -ge 2 ] || usage_error "expected DIR and MANIFEST"
  DIR=$1
  local manifest=$2
  shift 2
  EXPECTED=("$@")
  [ -d "$DIR" ] || usage_error "${DIR} is not a directory"
  check_expected_are_bare_names
  read_manifest "$manifest"
  check_manifest_names
  check_listed_files
  check_unlisted_entries
  if [ "$PROBLEMS" -gt 0 ]; then
    printf '%d problem(s) with the files in %s\n' "$PROBLEMS" "$DIR" >&2
    exit 1
  fi
  printf 'Digests verified: %d file(s) in %s\n' "${#NAMES[@]}" "$DIR"
}

main "$@"
