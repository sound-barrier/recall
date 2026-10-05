#!/usr/bin/env bash
# Install the pinned mise release into ~/.local/bin, checksum-verified.
#
# Replaces `curl https://mise.run | sh`, which ran whatever installer script
# that host served and installed whichever mise was newest that day. Linux only
# (initialize.sh's Debian path and the devcontainer): macOS gets mise from
# Homebrew, and mise.toml's min_version refuses a mise too old to read
# mise.lock.
#
# MISE_VERSION must equal `version` in .github/actions/setup-mise/action.yml
# and min_version in mise.toml; bump all three, and mise.lock, together. Each
# hash is the raw-binary line (`./mise-vX.Y.Z-<target>`, not a .tar.* line) of
# that release's SHASUMS256.txt; the linux-x64 one equals setup-mise's sha256.
#
# Usage: bash scripts/install-mise.sh
set -euo pipefail

MISE_VERSION="2026.9.16"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    target="linux-x64"
    sha256="b6f8757201f6a2ee799f45f3f52ef7ca0b4071523637dc3b0b24264dd3333518"
    ;;
  Linux-aarch64 | Linux-arm64)
    target="linux-arm64"
    sha256="acd7c94deb506567d1f8e2c65f4c154bc642e94497865c80bd370b2af6be7be2"
    ;;
  *)
    printf 'install-mise: no pinned mise %s build for %s-%s\n' \
      "${MISE_VERSION}" "$(uname -s)" "$(uname -m)" >&2
    exit 1
    ;;
esac

bin_dir="${HOME}/.local/bin"
mkdir -p "${bin_dir}"
download="$(mktemp "${bin_dir}/mise.download.XXXXXX")"
trap 'rm -f "${download}"' EXIT

curl -fsSL -o "${download}" \
  "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-${target}"
if ! printf '%s  %s\n' "${sha256}" "${download}" | sha256sum --check --status -; then
  printf 'install-mise: mise-v%s-%s does not match its pinned SHA-256; not installed\n' \
    "${MISE_VERSION}" "${target}" >&2
  exit 1
fi
chmod 0755 "${download}"
mv "${download}" "${bin_dir}/mise"
printf 'install-mise: installed mise %s (%s) at %s\n' "${MISE_VERSION}" "${target}" "${bin_dir}/mise"
