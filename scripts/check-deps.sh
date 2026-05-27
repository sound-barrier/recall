#!/usr/bin/env bash
# scripts/check-deps.sh — compare pinned tool versions against latest releases.
# Read-only: prints what is out of date, makes no changes.
# Usage: make check-deps   OR   bash scripts/check-deps.sh
#
# Checks binary tool pins in .devcontainer/postCreate.sh plus Go and Node
# toolchain versions (informational only — does not affect the exit code).
#
# Auto-managed tools are intentionally omitted:
#   • golangci-lint, gofumpt, shfmt, govulncheck  — go install @latest in CI
#   • ESLint, typescript-eslint, stylelint, htmlhint, vue-tsc — Dependabot npm
#   • hadolint-action, trivy-action, setup-go, setup-node — Dependabot Actions
#
# Requires: curl, jq

set -euo pipefail

for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    printf 'error: %s is required (brew install %s)\n' "$cmd" "$cmd" >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Versions shared across Make, lefthook, CI workflows, and the install
# scripts. Sourced here so the check rows below can reference them
# without re-parsing each file.
# shellcheck source=../tool-versions.env disable=SC1091
. "${ROOT}/tool-versions.env"

# Color support — disabled when stdout is not a terminal.
if [ -t 1 ]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  RESET='\033[0m'
else
  BOLD=''
  DIM=''
  GREEN=''
  RED=''
  YELLOW=''
  RESET=''
fi

outdated=0

gh_latest() {
  curl -fsSL "https://api.github.com/repos/${1}/releases/latest" | jq -r .tag_name
}

npm_latest() {
  curl -fsSL "https://registry.npmjs.org/${1}/latest" | jq -r .version
}

strip_v() { printf '%s' "${1#v}"; }

# check <name> <pinned> <latest> <files>
# Exact match required. Sets outdated=1 and prints update instructions if they differ.
check() {
  local name="$1" pinned="$2" latest="$3" files="$4"
  local p l
  p=$(strip_v "$pinned")
  l=$(strip_v "$latest")
  if [ "$p" = "$l" ]; then
    printf '  %-14s  %-14s  %-14s  %b\n' \
      "$name" "$pinned" "$latest" "${GREEN}✓${RESET}"
  else
    printf '  %-14s  %-14s  %-14s  %b  → update: %s\n' \
      "$name" "$pinned" "$latest" "${RED}✗${RESET}" "$files"
    outdated=1
  fi
}

# info <name> <pinned> <latest> <note>
# Informational row — does not affect the exit code.
info() {
  local name="$1" pinned="$2" latest="$3" note="$4"
  local p l sym
  p=$(strip_v "$pinned")
  l=$(strip_v "$latest")
  if [ "$p" = "$l" ]; then
    sym="${GREEN}✓${RESET}"
  else
    sym="${YELLOW}~${RESET}"
  fi
  printf '  %-14s  %-14s  %-14s  %b  %b%s%b\n' \
    "$name" "$pinned" "$latest" "$sym" "$DIM" "$note" "$RESET"
}

printf '\n%bChecking pinned tool versions against latest releases…%b\n' "$BOLD" "$RESET"
printf '%b(golangci-lint/gofumpt/shfmt/govulncheck → @latest; package.json + Actions → Dependabot)%b\n\n' \
  "$DIM" "$RESET"
printf '  %-14s  %-14s  %-14s\n' "Tool" "Pinned" "Latest"
printf '  %s\n' "────────────────────────────────────────────────────────────────────"

# ── Binary tool pins (.devcontainer/postCreate.sh) ─────────────────────────
# These are exact pins; a mismatch means the devcontainer and CI are behind.

WAILS_PINNED=$(grep 'WAILS_VERSION=' "${ROOT}/.devcontainer/postCreate.sh" \
  | head -1 | cut -d'"' -f2)
WAILS_LATEST=$(gh_latest wailsapp/wails)
check "Wails CLI" "$WAILS_PINNED" "$WAILS_LATEST" \
  ".devcontainer/postCreate.sh  .github/workflows/{ci,release}.yml"

HADOLINT_PINNED=$(grep 'HADOLINT_VERSION=' "${ROOT}/.devcontainer/postCreate.sh" \
  | head -1 | cut -d'"' -f2)
HADOLINT_LATEST=$(gh_latest hadolint/hadolint)
check "hadolint" "$HADOLINT_PINNED" "$HADOLINT_LATEST" \
  ".devcontainer/postCreate.sh"

LEFTHOOK_PINNED=$(grep 'LEFTHOOK_VERSION=' "${ROOT}/.devcontainer/postCreate.sh" \
  | head -1 | cut -d'"' -f2)
LEFTHOOK_LATEST=$(strip_v "$(gh_latest evilmartians/lefthook)")
check "lefthook" "$LEFTHOOK_PINNED" "$LEFTHOOK_LATEST" \
  ".devcontainer/postCreate.sh"

TRIVY_PINNED=$(grep 'TRIVY_VERSION=' "${ROOT}/.devcontainer/postCreate.sh" \
  | head -1 | cut -d'"' -f2)
TRIVY_LATEST=$(strip_v "$(gh_latest aquasecurity/trivy)")
check "trivy" "$TRIVY_PINNED" "$TRIVY_LATEST" \
  ".devcontainer/postCreate.sh"

# ── tool-versions.env entries ──────────────────────────────────────────────
# Single source of truth shared with Make, lefthook, and CI workflows.

SPECTRAL_LATEST=$(npm_latest @stoplight/spectral-cli)
check "Spectral" "$SPECTRAL_VERSION" "$SPECTRAL_LATEST" "tool-versions.env"

TYPOS_LATEST=$(gh_latest crate-ci/typos)
check "typos" "$TYPOS_VERSION" "$TYPOS_LATEST" "tool-versions.env"

GOSEC_LATEST=$(gh_latest securego/gosec)
check "gosec" "$GOSEC_VERSION" "$GOSEC_LATEST" "tool-versions.env"

SEMGREP_LATEST=$(gh_latest semgrep/semgrep)
check "Semgrep" "$SEMGREP_VERSION" "$SEMGREP_LATEST" "tool-versions.env"

HONKIT_LATEST=$(npm_latest honkit)
check "Honkit" "$HONKIT_VERSION" "$HONKIT_LATEST" "tool-versions.env"

# Verify literal version strings in workflow files match tool-versions.env.
# GitHub Actions `uses:` refs cannot interpolate expressions, so the
# crate-ci/typos action ref stays a literal SHA pin. The trailing
# "# vX.Y.Z" comment (per the project's SHA-pinning convention) MUST
# equal $TYPOS_VERSION or the spell-check step runs a different version
# than the rest of the project.
TYPOS_ACTION_PINNED=$(grep -oE 'crate-ci/typos@[a-f0-9]{40}  # v[0-9.]+' \
  "${ROOT}/.github/workflows/ci.yml" | head -1 | sed -E 's/.*# (v[0-9.]+)/\1/')
if [ "$TYPOS_ACTION_PINNED" != "$TYPOS_VERSION" ]; then
  printf '  %-14s  %-14s  %-14s  %b  → ci.yml uses %s; bump it to match tool-versions.env\n' \
    "typos@action" "$TYPOS_VERSION" "$TYPOS_ACTION_PINNED" "${RED}✗${RESET}" "$TYPOS_ACTION_PINNED"
  outdated=1
else
  printf '  %-14s  %-14s  %-14s  %b\n' \
    "typos@action" "$TYPOS_VERSION" "$TYPOS_ACTION_PINNED" "${GREEN}✓${RESET}"
fi

# ── Toolchain versions (informational) ─────────────────────────────────────
# The devcontainer feature and CI's setup-go/setup-node actions install the
# latest patch within the pinned major.minor, so only a new minor/major matters.

# devcontainer.json uses JSONC (// comments), so jq can't parse it directly.
# Use grep to pull the version out of the feature's "version" line.
GO_PINNED=$(grep -A2 'features/go:1' "${ROOT}/.devcontainer/devcontainer.json" \
  | grep '"version"' | grep -o '"[0-9.]*"' | tr -d '"')
GO_LATEST_FULL=$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1 | sed 's/^go//')
GO_LATEST_MINOR=$(printf '%s' "$GO_LATEST_FULL" | cut -d. -f1-2)
if [ "$GO_PINNED" = "$GO_LATEST_MINOR" ]; then
  info "Go" "$GO_PINNED" "$GO_LATEST_FULL" "latest patch auto-installed"
else
  info "Go" "$GO_PINNED" "$GO_LATEST_FULL" \
    "new minor — devcontainer.json + ci.yml + release.yml"
fi

NODE_PINNED=$(grep -A2 'features/node:1' "${ROOT}/.devcontainer/devcontainer.json" \
  | grep '"version"' | grep -o '"[0-9]*"' | tr -d '"')
NODE_LATEST=$(curl -fsSL 'https://nodejs.org/dist/index.json' \
  | jq -r '.[0].version | ltrimstr("v")')
NODE_LATEST_MAJOR=$(printf '%s' "$NODE_LATEST" | cut -d. -f1)
if [ "$NODE_PINNED" = "$NODE_LATEST_MAJOR" ]; then
  info "Node" "$NODE_PINNED" "$NODE_LATEST" "latest patch auto-installed"
else
  info "Node" "$NODE_PINNED" "$NODE_LATEST" \
    "new major — devcontainer.json + ci.yml"
fi

printf '\n'
if [ "$outdated" -eq 0 ]; then
  printf '%b✓ All binary tool pins are current.%b\n\n' "$GREEN" "$RESET"
else
  printf '%b✗ Some pins are out of date — bump the files listed above.%b\n\n' "$RED" "$RESET"
fi

exit "$outdated"
