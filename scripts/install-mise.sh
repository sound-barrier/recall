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

MISE_VERSION="2026.9.3"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    target="linux-x64"
    sha256="981bd9179cc089114a87b491fce2c4007ab05b5445dee7ad08e87e5dffcc154d"
    ;;
  Linux-aarch64 | Linux-arm64)
    target="linux-arm64"
    sha256="d8fa3d3fa2a21979c54c548967325a9db72f2a157996e8c536f62947b25592b7"
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
