#!/usr/bin/env bash
# Recall — one-shot setup for a fresh clone.
#
# Supported: macOS (Homebrew), Debian/Ubuntu (apt).
# Idempotent — safe to re-run after editing the Brewfile, bumping a pinned
# tool version in mise.toml, or adding a new mise-managed tool.
#
# mise (https://mise.jdx.dev) owns the whole toolchain: it reads mise.toml and
# installs pinned go, node, task (go-task), wails, and every linter/formatter/
# scanner. This script only has to install mise + the handful of *system*
# packages mise can't manage (Tesseract OCR, the container runtime, and — on
# Debian — the WebKitGTK dev headers Wails links against), then hand off to
# `mise install`.
#
# Run: ./initialize.sh   (or:  task init)

set -euo pipefail

log() { printf '\033[1;34m[ init ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ init ]\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31m[ init ]\033[0m %s\n' "$*" >&2
  exit 1
}

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

# ─── System packages + mise ──────────────────────────────────────────
case "$PLATFORM" in
  macos)
    command -v brew >/dev/null 2>&1 || die "Homebrew not found. Install from https://brew.sh."
    log "brew bundle (mise + tesseract + podman + pipx + cloc; idempotent)…"
    brew bundle --quiet
    ;;

  debian)
    log "apt packages (sudo required)…"
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      tesseract-ocr \
      sqlite3 \
      cloc \
      pipx \
      ca-certificates \
      curl \
      wget \
      unzip \
      git \
      libwebkit2gtk-4.1-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      pkg-config \
      build-essential

    # Wails v2 references webkit2gtk-4.0 in its CGo directives, but Debian
    # bookworm+/Ubuntu 24.04+ only ship 4.1. Drop pkg-config shim files that
    # redirect the 4.0 names to the installed 4.1 libraries (mirrors
    # Dockerfile.build's linux-builder stage). The `task dev` target also
    # passes `-tags webkit2_4_1`, so this is belt-and-suspenders.
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

    # mise is not in Debian's repos — install via the official one-liner.
    # It lands in ~/.local/bin; add that to PATH for the rest of this run.
    if ! command -v mise >/dev/null 2>&1; then
      log "Installing mise (https://mise.run)…"
      curl -fsSL https://mise.run | sh
    fi
    export PATH="${HOME}/.local/bin:${PATH}"
    ;;
esac

command -v mise >/dev/null 2>&1 || die "mise not on PATH after install. See https://mise.jdx.dev/getting-started.html."

# ─── Toolchain via mise ──────────────────────────────────────────────
# Reads mise.toml: go, node, task, wails, the Go/JS/shell linters and
# formatters (golangci-lint, gofumpt, shfmt, yamllint, hadolint, actionlint,
# typos, ruff, trivy, lefthook, jq, gosec, govulncheck, deadcode,
# goimports-reviser, gocyclo) and the pipx SAST/fuzz tools (semgrep,
# schemathesis). Pinned versions live there — `task check-deps` validates them.
log "mise trust && mise install (toolchain + linters)…"
mise trust
mise install

# ─── Frontend deps + git hooks (via mise-managed node/lefthook) ──────
log "frontend: npm ci"
mise exec -- bash -c 'cd frontend && npm ci --no-audit --no-fund'

log "lefthook install (wires .git/hooks/{pre-commit, commit-msg, pre-push})"
mise exec -- lefthook install

# ─── Done ────────────────────────────────────────────────────────────
cat <<'EOF'

──────────────────────────────────────────────────────────────
Recall ready to develop.

One-time shell setup — activate mise so the toolchain + RECALL_DATA_DIR
load automatically when you cd into the repo. Add to ~/.zshrc or ~/.bashrc:
  eval "$(mise activate zsh)"   # or "bash"
…then open a new shell (or `eval` it now).

Next steps:
  • macOS or Debian: task dev   (Wails hot-reload desktop app with
                                  Vite HMR + live Go rebuild)
  • Headless / inside a container:
      go run -tags serveronly . --server
      (browse http://127.0.0.1:7000)

Useful tasks:
  task --list       list every task
  task lint         run every linter
  task test         Go race tests + Vitest
  task check-deps   validate pinned-tool versions
──────────────────────────────────────────────────────────────
EOF
