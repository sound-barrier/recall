# shellcheck shell=bash
# Smoke cases for scripts/release/compute-sha256.sh. Sourced by ../smoke.sh,
# which sets RELEASE_DIR and REPO_ROOT and loads ../lib/_harness.sh.

smoke_compute_sha256() {
  printf '\n# compute-sha256.sh\n'
  if ! command -v sha256sum >/dev/null 2>&1; then
    skip "compute-sha256.sh smoke" "sha256sum not on PATH (try shasum -a 256 instead)"
    return 0
  fi
  run_in_temp _smoke_compute_sha256_inner
}

_smoke_compute_sha256_inner() {
  # Plant one fake artifact of each shape the script's glob matches:
  # the installer exe, the raw updater exe, a reference YAML, the bat,
  # the SBOM.
  printf 'a\n' >recall-0.0.0-smoke-windows-amd64-installer.exe
  printf 'b\n' >recall-0.0.0-smoke-windows-amd64.exe
  printf 'c\n' >recall-0.0.0-smoke-heroes.yaml
  printf 'd\n' >recall-0.0.0-smoke-Reset-Database.bat
  printf '{}\n' >recall-0.0.0-smoke-sbom.spdx.json

  # Also files the globs must NOT pick up: a non-recall exe, and a
  # signature, which its release key already binds to the exe.
  printf 'not-recall\n' >unrelated-file.exe
  printf 'sig\n' >recall-0.0.0-smoke-windows-amd64.exe.sig

  if ! bash "${RELEASE_DIR}/compute-sha256.sh" >/dev/null 2>&1; then
    not_ok "compute-sha256.sh exited non-zero"
    return 0
  fi
  ok "compute-sha256.sh exited zero"

  local f
  for f in recall-0.0.0-smoke-windows-amd64-installer.exe \
    recall-0.0.0-smoke-windows-amd64.exe \
    recall-0.0.0-smoke-heroes.yaml \
    recall-0.0.0-smoke-Reset-Database.bat \
    recall-0.0.0-smoke-sbom.spdx.json; do
    if [ -f "${f}.sha256" ]; then
      ok "compute-sha256.sh produced ${f}.sha256"
    else
      not_ok "compute-sha256.sh missing ${f}.sha256"
    fi
    # The updater looks its exe up in SHA256SUMS by bare name.
    if _sums_name "$f"; then
      ok "SHA256SUMS names ${f} without a directory"
    else
      not_ok "SHA256SUMS has no bare-name line for ${f}"
    fi
  done

  # The combined SHA256SUMS the in-app updater consumes must exist.
  if [ -f SHA256SUMS ]; then
    ok "compute-sha256.sh produced SHA256SUMS"
  else
    not_ok "compute-sha256.sh missing SHA256SUMS"
  fi

  if [ -f unrelated-file.exe.sha256 ]; then
    not_ok "compute-sha256.sh picked up unrelated-file.exe (glob too wide)"
  else
    ok "compute-sha256.sh leaves non-recall-* files alone"
  fi

  if [ -f recall-0.0.0-smoke-windows-amd64.exe.sig.sha256 ] \
    || _sums_name recall-0.0.0-smoke-windows-amd64.exe.sig; then
    not_ok "compute-sha256.sh checksummed a .sig"
  else
    ok "compute-sha256.sh leaves .sig files out"
  fi
}

_sums_name() { # <name>
  awk -v name="$1" '$2 == name { found = 1 } END { exit !found }' SHA256SUMS
}
