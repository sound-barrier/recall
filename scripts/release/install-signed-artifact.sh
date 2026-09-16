#!/usr/bin/env bash
# scripts/release/install-signed-artifact.sh — move a signed artifact returned
# by SignPath into the build tree, refusing anything that is not actually
# signed.
#
# Called by the build-windows job in .github/workflows/release.yml, once for
# the raw exe and once for the NSIS installer.
#
# Usage: install-signed-artifact.sh <signed-file> <destination>
#
# The check that earns this its own script: an Authenticode signature is
# APPENDED to a PE file, in the certificate table past the last section. A
# genuinely signed binary is therefore strictly LARGER than the input. If
# SignPath hands back a file the same size, the signing policy matched nothing
# and returned the input untouched -- which would sail through a plain
# `mv` and ship an unsigned binary inside a release that claims to be signed.
# That is worse than the unsigned release this whole lane exists to end,
# because nothing downstream would ever say so.
#
# Exit: 0 installed · 1 the artifact is missing, empty, or unsigned

set -euo pipefail

SIGNED="${1:-}"
DEST="${2:-}"

if [ -z "${SIGNED}" ] || [ -z "${DEST}" ]; then
  printf 'usage: install-signed-artifact.sh <signed-file> <destination>\n' >&2
  exit 1
fi

if [ ! -f "${SIGNED}" ]; then
  printf 'error: signed artifact not found: %s\n' "${SIGNED}" >&2
  printf '       SignPath returned nothing at that path — check the\n' >&2
  printf '       artifact-configuration-slug matches the uploaded shape.\n' >&2
  exit 1
fi

if [ ! -f "${DEST}" ]; then
  printf 'error: destination not found: %s\n' "${DEST}" >&2
  exit 1
fi

signed_size="$(wc -c <"${SIGNED}" | tr -d '[:space:]')"
unsigned_size="$(wc -c <"${DEST}" | tr -d '[:space:]')"

if [ "${signed_size}" -eq 0 ]; then
  printf 'error: signed artifact is empty: %s\n' "${SIGNED}" >&2
  exit 1
fi

if [ "${signed_size}" -le "${unsigned_size}" ]; then
  printf 'error: %s carries no Authenticode signature\n' "${SIGNED}" >&2
  printf '       signed=%s bytes, unsigned=%s bytes — a signature only ever\n' \
    "${signed_size}" "${unsigned_size}" >&2
  printf '       makes a PE file bigger, so SignPath returned the input\n' >&2
  printf '       unchanged. Refusing to ship it as signed.\n' >&2
  exit 1
fi

mv -f "${SIGNED}" "${DEST}"
printf '[ recall ] signed %s (%s -> %s bytes)\n' \
  "${DEST}" "${unsigned_size}" "${signed_size}"
