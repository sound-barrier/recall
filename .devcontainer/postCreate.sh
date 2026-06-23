#!/usr/bin/env bash
# Recall devcontainer post-create script.
#
# Runs once after the image is built. Installs the *system* packages mise
# can't manage (Tesseract OCR, sqlite3, cloc, pipx) then hands the whole
# toolchain off to mise (https://mise.jdx.dev), which reads mise.toml and
# installs pinned go, node, task (go-task), wails, and every linter. This
# mirrors a host `./initialize.sh` run, minus macOS-only bits — the
# devcontainer.json uses docker-in-docker instead of podman.
#
# Re-run anytime: `.devcontainer/postCreate.sh` is idempotent.

set -euo pipefail

WORKSPACE=/workspaces/recall

log() { printf '\033[1;34m[ postCreate ]\033[0m %s\n' "$*"; }

# ─── System packages (everything mise can't provide) ──────────────────
log "apt packages: tesseract, sqlite3, cloc, pipx, build deps…"
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
  build-essential
sudo rm -rf /var/lib/apt/lists/*

# pipx binaries land in ~/.local/bin, which isn't on PATH by default on a
# fresh container. mise's pipx: backend (semgrep, schemathesis) needs pipx
# reachable, so wire it up before `mise install`.
pipx ensurepath
export PATH="$HOME/.local/bin:$PATH"

# ─── mise: the rest of the toolchain ──────────────────────────────────
if ! command -v mise >/dev/null 2>&1; then
  log "Installing mise (https://mise.run)…"
  curl -fsSL https://mise.run | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# Assert Tesseract major.minor matches the pin in mise.toml so the
# parser-integration goldens (testdata/*.golden.json) reproduce byte-for-byte
# in the devcontainer. Loud-fail when the base image bumps the apt package —
# that's the signal to re-baseline + bump.
tesseract_pin=$(grep -E '^TESSERACT_VERSION[[:space:]]*=' "${WORKSPACE}/mise.toml" \
  | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
installed=$(tesseract --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
expected_mm=$(printf '%s' "$tesseract_pin" | cut -d. -f1-2)
installed_mm=$(printf '%s' "$installed" | cut -d. -f1-2)
if [ "$installed_mm" != "$expected_mm" ]; then
  log "WARNING: Tesseract major.minor mismatch: installed=$installed_mm expected=$expected_mm (TESSERACT_VERSION=$tesseract_pin). Re-baseline testdata/*.golden.json + bump the pin."
fi

log "mise trust && mise install (go, node, task, wails + every linter)…"
mise trust "${WORKSPACE}/mise.toml"
(cd "$WORKSPACE" && mise install)

# Activate mise in the vscode user's login shell so cd-ing into the
# workspace puts the toolchain + RECALL_DATA_DIR on PATH automatically.
if ! grep -q 'mise activate bash' "$HOME/.bashrc" 2>/dev/null; then
  cat >>"$HOME/.bashrc" <<'BASHRC'

# mise (post-create) — toolchain + project env
eval "$(mise activate bash)"
BASHRC
fi

# ─── Frontend deps + git hooks (via mise-managed node/lefthook) ───────
log "frontend: npm ci"
(cd "${WORKSPACE}" && mise exec -- bash -c 'cd frontend && npm ci --no-audit --no-fund')

log "lefthook install (wires .git/hooks/{pre-commit,commit-msg})"
(cd "${WORKSPACE}" && mise exec -- lefthook install)

# ─── Sanity: report installed versions ────────────────────────────────
log "done — tool versions:"
(
  cd "$WORKSPACE"
  {
    printf '  go             %s\n' "$(mise exec -- go version)"
    printf '  node           %s\n' "$(mise exec -- node --version)"
    printf '  task           %s\n' "$(mise exec -- task --version)"
    printf '  tesseract      %s\n' "$(tesseract --version 2>&1 | head -1)"
    printf '  golangci-lint  %s\n' "$(mise exec -- golangci-lint --version 2>&1 | head -1)"
    printf '  gofumpt        %s\n' "$(mise exec -- gofumpt --version)"
    printf '  wails          %s\n' "$(mise exec -- wails -v 2>&1 | head -1)"
    printf '  hadolint       %s\n' "$(mise exec -- hadolint --version)"
    printf '  lefthook       %s\n' "$(mise exec -- lefthook version)"
    printf '  trivy          %s\n' "$(mise exec -- trivy --version 2>&1 | head -1)"
    printf '  typos          %s\n' "$(mise exec -- typos --version 2>&1 | head -1)"
  } || true
)

cat <<'EOF'

────────────────────────────────────────────────────────────────────
Recall devcontainer ready.

Next steps:
  • The Wails GUI (`task dev`) won't run here — the container has no
    display surface. Use server mode instead:
        go run -tags serveronly . --server
    then open http://127.0.0.1:7000 (port-forwarded automatically).
    For a native Wails window, develop on a macOS or Debian/Ubuntu host
    (both run `task dev`); `task build-mac` also needs a macOS host.

  • Lint/test before committing:
        task lint    # golangci-lint, ESLint+typescript-eslint, Stylelint, HTMLHint, shellcheck+shfmt, Hadolint, yamllint, Spectral
        task test    # Go + Vitest

  • API spec change?  Regenerate types:
        task gen-types && task typecheck

  • Pre-commit hooks are installed.  Skip per-commit with:
        LEFTHOOK=0 git commit ...

See CONTRIBUTING.md for the full procedure.
────────────────────────────────────────────────────────────────────
EOF
