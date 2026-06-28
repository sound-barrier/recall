#!/usr/bin/env bash
# scripts/ci/check-deps.sh — compare pinned tool versions against latest releases.
# Read-only: prints what is out of date, makes no changes.
# Usage: task check-deps   OR   bash scripts/ci/check-deps.sh
#
# All pins live in mise.toml: [tools] holds the binary versions (go, node,
# wails, typos, ruff, schemathesis) and [env] holds the version STRINGS
# the on-demand npx/pipx invocations interpolate (SPECTRAL_VERSION,
# HONKIT_VERSION, …). This script parses mise.toml directly — no dependency on
# the mise binary, so it runs in minimal CI runners too.
#
# Auto-managed tools are intentionally omitted (they track @latest via mise or
# Dependabot, so there is no fixed pin to compare):
#   • golangci-lint, shfmt, govulncheck, deadcode,
#     gocyclo, hadolint, lefthook, trivy, jq  — mise "latest"
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
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MISE="${ROOT}/mise.toml"

# Read a `key = "value"` pin from mise.toml (first match). Handles both bare
# keys (go = "1.26.4") and quoted backend keys
# ("go:github.com/...wails" = "v2.12.0").
mise_pin() {
  grep -E "^\"?${1}\"?[[:space:]]*=[[:space:]]*\"" "${MISE}" | head -1 \
    | sed -E 's/^[^=]*=[[:space:]]*"([^"]+)".*/\1/'
}

SPECTRAL_VERSION=$(mise_pin SPECTRAL_VERSION)
TYPOS_VERSION=$(mise_pin TYPOS_VERSION)
SEMGREP_VERSION=$(mise_pin SEMGREP_VERSION)
HONKIT_VERSION=$(mise_pin HONKIT_VERSION)
SCHEMATHESIS_VERSION=$(mise_pin SCHEMATHESIS_VERSION)
RUFF_VERSION=$(mise_pin RUFF_VERSION)

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
printf '%b(golangci-lint/shfmt/govulncheck → @latest; package.json + Actions → Dependabot)%b\n\n' \
  "$DIM" "$RESET"
printf '  %-14s  %-14s  %-14s\n' "Tool" "Pinned" "Latest"
printf '  %s\n' "────────────────────────────────────────────────────────────────────"

# ── Exact tool pins (mise.toml) ────────────────────────────────────────────
# These are exact pins; a mismatch means mise + CI are behind upstream.

WAILS_PINNED=$(mise_pin 'go:github.com/wailsapp/wails/v2/cmd/wails')
WAILS_LATEST=$(gh_latest wailsapp/wails)
check "Wails CLI" "$WAILS_PINNED" "$WAILS_LATEST" "mise.toml [tools]"

SPECTRAL_LATEST=$(npm_latest @stoplight/spectral-cli)
check "Spectral" "$SPECTRAL_VERSION" "$SPECTRAL_LATEST" "mise.toml [env]"

TYPOS_LATEST=$(gh_latest crate-ci/typos)
check "typos" "$TYPOS_VERSION" "$TYPOS_LATEST" "mise.toml [env]/[tools]"

SEMGREP_LATEST=$(gh_latest semgrep/semgrep)
check "Semgrep" "$SEMGREP_VERSION" "$SEMGREP_LATEST" "mise.toml [env]/[tools]"

HONKIT_LATEST=$(npm_latest honkit)
check "Honkit" "$HONKIT_VERSION" "$HONKIT_LATEST" "mise.toml [env]"

# schemathesis — Python package; PyPI is the source of truth.
SCHEMATHESIS_LATEST=$(curl -fsSL https://pypi.org/pypi/schemathesis/json | jq -r .info.version)
check "schemathesis" "$SCHEMATHESIS_VERSION" "$SCHEMATHESIS_LATEST" "mise.toml [env]/[tools]"

# ruff — Python lint + format; PyPI is the source of truth.
RUFF_LATEST=$(curl -fsSL https://pypi.org/pypi/ruff/json | jq -r .info.version)
check "ruff" "$RUFF_VERSION" "$RUFF_LATEST" "mise.toml [env]/[tools]"

# Verify the literal typos action SHA-pin comment matches the mise pin.
# GitHub Actions `uses:` refs cannot interpolate expressions, so the
# crate-ci/typos action ref stays a literal SHA pin. The trailing
# "# vX.Y.Z" comment (per the project's SHA-pinning convention) MUST
# equal $TYPOS_VERSION or the spell-check step runs a different version
# than the rest of the project.
TYPOS_ACTION_PINNED=$(grep -oE 'crate-ci/typos@[a-f0-9]{40}  # v[0-9.]+' \
  "${ROOT}/.github/workflows/ci.yml" | head -1 | sed -E 's/.*# (v[0-9.]+)/\1/')
if [ "$TYPOS_ACTION_PINNED" != "$TYPOS_VERSION" ]; then
  printf '  %-14s  %-14s  %-14s  %b  → ci.yml uses %s; bump it to match mise.toml\n' \
    "typos@action" "$TYPOS_VERSION" "$TYPOS_ACTION_PINNED" "${RED}✗${RESET}" "$TYPOS_ACTION_PINNED"
  outdated=1
else
  printf '  %-14s  %-14s  %-14s  %b\n' \
    "typos@action" "$TYPOS_VERSION" "$TYPOS_ACTION_PINNED" "${GREEN}✓${RESET}"
fi

# ── Toolchain versions (informational) ─────────────────────────────────────
# mise installs the latest patch within the pinned major (node) or major.minor
# (go), so only a new minor/major matters.

GO_PINNED=$(mise_pin 'go')
GO_LATEST_FULL=$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1 | sed 's/^go//')
GO_LATEST_MINOR=$(printf '%s' "$GO_LATEST_FULL" | cut -d. -f1-2)
GO_PINNED_MINOR=$(printf '%s' "$GO_PINNED" | cut -d. -f1-2)
if [ "$GO_PINNED_MINOR" = "$GO_LATEST_MINOR" ]; then
  info "Go" "$GO_PINNED" "$GO_LATEST_FULL" "latest patch auto-installed"
else
  info "Go" "$GO_PINNED" "$GO_LATEST_FULL" \
    "new minor — mise.toml + ci.yml + release.yml"
fi

NODE_PINNED=$(mise_pin 'node')
NODE_LATEST=$(curl -fsSL 'https://nodejs.org/dist/index.json' \
  | jq -r '.[0].version | ltrimstr("v")')
NODE_LATEST_MAJOR=$(printf '%s' "$NODE_LATEST" | cut -d. -f1)
if [ "$NODE_PINNED" = "$NODE_LATEST_MAJOR" ]; then
  info "Node" "$NODE_PINNED" "$NODE_LATEST" "latest patch auto-installed"
else
  info "Node" "$NODE_PINNED" "$NODE_LATEST" \
    "new major — mise.toml + ci.yml"
fi

printf '\n'
if [ "$outdated" -eq 0 ]; then
  printf '%b✓ All binary tool pins are current.%b\n\n' "$GREEN" "$RESET"
else
  printf '%b✗ Some pins are out of date — bump the files listed above.%b\n\n' "$RED" "$RESET"
fi

exit "$outdated"
