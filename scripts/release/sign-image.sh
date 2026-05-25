#!/usr/bin/env bash
# scripts/release/sign-image.sh — sign each pushed GHCR tag with cosign
# keyless (Sigstore OIDC). Called by release.yml's "Sign container image"
# step after docker/build-push-action finishes.
#
# Signs by *digest*, not tag — a tag re-point after this script would
# otherwise silently invalidate the signature. Verification recipe in
# docs/docker.md → "Verifying the image".
#
# Required inputs (env vars):
#   DIGEST   — the sha256:... digest emitted by docker/build-push-action
#              (steps.push.outputs.digest in the workflow)
#   TAGS     — whitespace-separated list of pushed tags
#              (steps.meta.outputs.tags, multi-line)

set -euo pipefail

if [ -z "${DIGEST:-}" ]; then
  printf 'error: DIGEST is required\n' >&2
  exit 2
fi
if [ -z "${TAGS:-}" ]; then
  printf 'error: TAGS is required\n' >&2
  exit 2
fi

for tag in ${TAGS}; do
  image="${tag%:*}@${DIGEST}"
  echo "::group::cosign sign ${image}"
  cosign sign --yes "${image}"
  echo "::endgroup::"
done
