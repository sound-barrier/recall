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
  # the installer exe, the raw updater exe, a reference YAML, the bat.
  printf 'a\n' >recall-0.0.0-smoke-windows-amd64-installer.exe
  printf 'b\n' >recall-0.0.0-smoke-windows-amd64.exe
  printf 'c\n' >recall-0.0.0-smoke-heroes.yaml
  printf 'd\n' >recall-0.0.0-smoke-Reset-Database.bat

  # Also a non-matching file — the glob must NOT pick it up.
  printf 'not-recall\n' >unrelated-file.exe

  if ! bash "${RELEASE_DIR}/compute-sha256.sh" >/dev/null 2>&1; then
    not_ok "compute-sha256.sh exited non-zero"
    return 0
  fi
  ok "compute-sha256.sh exited zero"

  local f
  for f in recall-0.0.0-smoke-windows-amd64-installer.exe \
    recall-0.0.0-smoke-windows-amd64.exe \
    recall-0.0.0-smoke-heroes.yaml \
    recall-0.0.0-smoke-Reset-Database.bat; do
    if [ -f "${f}.sha256" ]; then
      ok "compute-sha256.sh produced ${f}.sha256"
    else
      not_ok "compute-sha256.sh missing ${f}.sha256"
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
}
