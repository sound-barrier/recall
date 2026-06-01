#!/usr/bin/env bash
# Recall — one-shot setup for a fresh clone.
#
# Supported: macOS (Homebrew), Debian/Ubuntu (apt + manual Go/Node).
# Idempotent — safe to re-run after editing the Brewfile, bumping a
# pinned tool version, or adding a new go-installed binary.
#
# Not handled (do these yourself first):
#   - Install Go 1.26+ and Node 22+. Both are version-sensitive
#     enough that picking a version manager (asdf, nvm, gvm) is
#     better than letting a setup script choose for you. The script
#     fails fast with a pointer if either is missing or too old.
#   - macOS: `xcode-select --install` (needs an interactive accept).
#   - Add the direnv shell hook to ~/.zshrc or ~/.bashrc once:
#       eval "$(direnv hook zsh)"   # or "bash"
#
# Run: ./initialize.sh   (or:  make init)

set -euo pipefail

log()  { printf '\033[1;34m[ init ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ init ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[ init ]\033[0m %s\n' "$*" >&2; exit 1; }

# Pinned tool versions for the Debian path. Mirror Wails/hadolint/
# lefthook/trivy from .devcontainer/postCreate.sh; `make check-deps`
# validates them against upstream. The typos and gosec versions are
# sourced from tool-versions.env at repo root so Make, lefthook,
# CI workflows, and the devcontainer all read the same value.
WAILS_VERSION="v2.12.0"
HADOLINT_VERSION="v2.14.0"
LEFTHOOK_VERSION="2.1.8"
TRIVY_VERSION="0.70.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tool-versions.env disable=SC1091
. "${SCRIPT_DIR}/tool-versions.env"

# Minimum language-toolchain versions. The Brewfile / apt path
# can't bring these in cleanly (Debian's go/node packages are
# usually too old), so we just verify presence + minimum major.
REQ_GO_MAJOR=1
REQ_GO_MINOR=26
REQ_NODE_MAJOR=22

# ─── Platform detection ──────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
    Darwin)
        PLATFORM=macos
        ;;
    Linux)
        if command -v apt-get >/dev/null 2>&1; then
            PLATFORM=debian
        else
            die "Unsupported Linux distro (no apt-get). Open an issue at https://github.com/sound-barrier/recall/issues if you want apk/dnf/pacman support."
        fi
        ;;
    *)
        die "Unsupported OS: $OS. Only macOS and Debian/Ubuntu are supported."
        ;;
esac
log "Platform: $PLATFORM"

# ─── Toolchain version checks (both platforms) ───────────────────────
command -v go   >/dev/null 2>&1 || die "Go is not installed. Recall needs Go ${REQ_GO_MAJOR}.${REQ_GO_MINOR}+. Install from https://go.dev/dl/ or via asdf/gvm."
command -v node >/dev/null 2>&1 || die "Node is not installed. Recall needs Node ${REQ_NODE_MAJOR}+. Install from https://nodejs.org/ or via nvm/asdf."

go_version=$(go env GOVERSION | sed 's/^go//')
go_major=${go_version%%.*}
go_minor_etc=${go_version#*.}
go_minor=${go_minor_etc%%.*}
if [ "$go_major" -lt "$REQ_GO_MAJOR" ] || { [ "$go_major" -eq "$REQ_GO_MAJOR" ] && [ "$go_minor" -lt "$REQ_GO_MINOR" ]; }; then
    die "Go ${go_version} is too old. Recall needs ${REQ_GO_MAJOR}.${REQ_GO_MINOR}+. Upgrade from https://go.dev/dl/."
fi
log "Go ${go_version} ✓"

node_version=$(node --version)
node_version=${node_version#v}
node_major=${node_version%%.*}
if [ "$node_major" -lt "$REQ_NODE_MAJOR" ]; then
    die "Node ${node_version} is too old. Recall needs ${REQ_NODE_MAJOR}+. Upgrade from https://nodejs.org/."
fi
log "Node ${node_version} ✓"

# ─── System packages ─────────────────────────────────────────────────
case "$PLATFORM" in
    macos)
        command -v brew >/dev/null 2>&1 || die "Homebrew not found. Install from https://brew.sh."
        log "brew bundle (idempotent — skips anything already installed)…"
        brew bundle --quiet

        # Go-installed tools NOT in the Brewfile. macOS gets the rest
        # (golangci-lint, shfmt, hadolint, lefthook, trivy, yamllint,
        # tesseract, jq, cloc, direnv, semgrep, pipx) from brew above.
        log "go install: wails ${WAILS_VERSION}, gofumpt, goimports-reviser, deadcode, govulncheck"
        go install "github.com/wailsapp/wails/v2/cmd/wails@${WAILS_VERSION}"
        go install mvdan.cc/gofumpt@latest
        go install github.com/incu6us/goimports-reviser/v3@latest
        go install golang.org/x/tools/cmd/deadcode@latest
        go install golang.org/x/vuln/cmd/govulncheck@latest

        # schemathesis — OpenAPI ↔ server contract fuzzer. Pipx is
        # installed via brew above; ensure pipx's bin dir is on PATH
        # so the install lands somewhere usable. Pin matches the
        # debian / devcontainer / CI install paths.
        pipx ensurepath >/dev/null
        log "pipx schemathesis (>=3.36,<4)"
        pipx install 'schemathesis>=3.36,<4' >/dev/null || true
        ;;

    debian)
        log "apt packages (sudo required)…"
        sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
            tesseract-ocr \
            sqlite3 \
            jq \
            yamllint \
            shellcheck \
            cloc \
            direnv \
            ca-certificates \
            curl \
            wget \
            unzip \
            pipx \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            pkg-config \
            build-essential

        # Wails v2.12.0 references webkit2gtk-4.0 in its CGo directives,
        # but Debian bookworm+/Ubuntu 24.04+ only ship 4.1. Drop pkg-config
        # shim files that redirect the 4.0 names to the installed 4.1
        # libraries (mirrors Dockerfile.build's linux-builder stage). The
        # Makefile's `dev` target also passes `-tags webkit2_4_1`, so
        # this is belt-and-suspenders — either alone would compile, both
        # together survive a future Wails CGo refactor.
        log "pkg-config shims: webkit2gtk-4.0 → 4.1, javascriptcoregtk-4.0 → 4.1"
        sudo tee /usr/lib/x86_64-linux-gnu/pkgconfig/webkit2gtk-4.0.pc >/dev/null <<'PC'
Name: webkit2gtk-4.0
Description: compat shim
Version: 4.1
Requires: webkit2gtk-4.1
Cflags:
Libs:
PC
        sudo tee /usr/lib/x86_64-linux-gnu/pkgconfig/javascriptcoregtk-4.0.pc >/dev/null <<'PC'
Name: javascriptcoregtk-4.0
Description: compat shim
Version: 4.1
Requires: javascriptcoregtk-4.1
Cflags:
Libs:
PC

        # Go-installed tools matching .devcontainer/postCreate.sh.
        # golangci-lint via go install (not apt) so the version is
        # compiled against the current Go toolchain.
        log "go install: golangci-lint, gofumpt, goimports-reviser, shfmt, govulncheck, deadcode, actionlint, gosec, wails ${WAILS_VERSION}"
        go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
        go install mvdan.cc/gofumpt@latest
        go install github.com/incu6us/goimports-reviser/v3@latest
        go install mvdan.cc/sh/v3/cmd/shfmt@latest
        go install golang.org/x/vuln/cmd/govulncheck@latest
        go install golang.org/x/tools/cmd/deadcode@latest
        go install github.com/rhysd/actionlint/cmd/actionlint@latest
        go install "github.com/securego/gosec/v2/cmd/gosec@${GOSEC_VERSION}"
        go install "github.com/wailsapp/wails/v2/cmd/wails@${WAILS_VERSION}"

        # Binary releases — re-installs on every run (idempotent;
        # ~30 MB total across all three). Cheap insurance against
        # version drift after `make check-deps` flags a bump.
        log "hadolint ${HADOLINT_VERSION}"
        sudo curl -fsSL "https://github.com/hadolint/hadolint/releases/download/${HADOLINT_VERSION}/hadolint-Linux-x86_64" \
            -o /usr/local/bin/hadolint
        sudo chmod +x /usr/local/bin/hadolint

        log "lefthook ${LEFTHOOK_VERSION}"
        curl -fsSL "https://github.com/evilmartians/lefthook/releases/download/v${LEFTHOOK_VERSION}/lefthook_${LEFTHOOK_VERSION}_Linux_x86_64.tar.gz" \
            | sudo tar -xz -C /usr/local/bin lefthook
        sudo chmod +x /usr/local/bin/lefthook

        log "trivy ${TRIVY_VERSION}"
        curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
            | sudo tar -xz -C /usr/local/bin trivy
        sudo chmod +x /usr/local/bin/trivy

        log "typos ${TYPOS_VERSION}"
        curl -fsSL "https://github.com/crate-ci/typos/releases/download/${TYPOS_VERSION}/typos-${TYPOS_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
            | sudo tar -xz -C /usr/local/bin ./typos
        sudo chmod +x /usr/local/bin/typos

        # semgrep — JS/TS SAST. Installed via pipx so the CLI lands
        # on PATH without polluting system Python. Matches the
        # devcontainer + CI install path.
        log "semgrep ${SEMGREP_VERSION}"
        pipx install "semgrep==${SEMGREP_VERSION}"

        # schemathesis — OpenAPI ↔ server contract fuzzer. Powers
        # `make check-api-drift` and the pre-push lefthook hook of
        # the same name. Pinned to v3.x (v4 renamed --base-url →
        # --url and changed several flag shapes).
        log "schemathesis (>=3.36,<4)"
        pipx install 'schemathesis>=3.36,<4'
        ;;
esac

# ─── Frontend deps ───────────────────────────────────────────────────
log "frontend: npm ci"
(cd frontend && npm ci --no-audit --no-fund)

# ─── Git hooks ───────────────────────────────────────────────────────
log "lefthook install (wires .git/hooks/{pre-commit, commit-msg, pre-push})"
lefthook install

# ─── direnv ──────────────────────────────────────────────────────────
if command -v direnv >/dev/null 2>&1 && [ -f .envrc ]; then
    log "direnv allow"
    direnv allow .
else
    warn "direnv not installed or no .envrc — skipping"
fi

# ─── Done ────────────────────────────────────────────────────────────
cat <<'EOF'

──────────────────────────────────────────────────────────────
Recall ready to develop.

Next steps:
  • macOS or Debian: make dev   (Wails hot-reload desktop app
                                  with Vite HMR + live Go rebuild)
  • Headless / inside a container:
      go run -tags serveronly . --server
      (browse http://127.0.0.1:7000)

Useful targets:
  make help        list every target
  make lint        run every linter
  make test        Go race tests + Vitest
  make check-deps  validate pinned-tool versions

If direnv hasn't picked up the .envrc, add the shell hook to
~/.zshrc or ~/.bashrc:
  eval "$(direnv hook zsh)"   # or "bash"
──────────────────────────────────────────────────────────────
EOF
