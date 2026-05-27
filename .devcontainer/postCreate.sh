#!/usr/bin/env bash
# Recall devcontainer post-create script.
#
# Runs once after the image is built. Installs everything the
# Brewfile pulls in plus the `go install` and `npm ci` tooling
# CONTRIBUTING.md documents — minus macOS-only bits (sips,
# podman/podman-compose; the devcontainer.json uses docker-in-docker
# instead).
#
# Re-run anytime: `.devcontainer/postCreate.sh` is idempotent.

set -euo pipefail

log() { printf '\033[1;34m[ postCreate ]\033[0m %s\n' "$*"; }

# Pinned versions — bump deliberately. Run `make check-deps` to see what
# is out of date. Matches the workflow files in .github/workflows/ and
# the per-platform install instructions in CONTRIBUTING.md. The typos
# and gosec versions are sourced from tool-versions.env at repo root so
# Make, lefthook, CI workflows, and the devcontainer all read the same
# value.
WAILS_VERSION="v2.12.0"
HADOLINT_VERSION="v2.14.0"
LEFTHOOK_VERSION="2.1.8"
TRIVY_VERSION="0.70.0"

# shellcheck source=../tool-versions.env disable=SC1091
. /workspaces/recall/tool-versions.env

# ─── apt packages (Brewfile equivalents) ──────────────────────────────
log "apt packages: tesseract, sqlite3, jq, yamllint, cloc, direnv, …"
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    tesseract-ocr \
    sqlite3 \
    jq \
    yamllint \
    cloc \
    direnv \
    ca-certificates \
    curl \
    wget \
    unzip \
    pipx
sudo rm -rf /var/lib/apt/lists/*

# Wire pipx onto PATH for the rest of this script + the user's shell.
# pipx itself is in apt as `pipx`; binaries land in ~/.local/bin which
# isn't on PATH by default on a fresh container.
pipx ensurepath
export PATH="$HOME/.local/bin:$PATH"

# Assert Tesseract major.minor matches the pin in tool-versions.env so
# the parser-integration goldens (testdata/*.golden.json) reproduce
# byte-for-byte in the devcontainer. Loud-fail when the base image
# bumps the apt package — that's the signal to re-baseline + bump.
installed=$(tesseract --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
expected_mm=$(printf '%s' "$TESSERACT_VERSION" | cut -d. -f1-2)
installed_mm=$(printf '%s' "$installed" | cut -d. -f1-2)
if [ "$installed_mm" != "$expected_mm" ]; then
  log "WARNING: Tesseract major.minor mismatch: installed=$installed_mm expected=$expected_mm (TESSERACT_VERSION=$TESSERACT_VERSION). Re-baseline testdata/*.golden.json + bump the pin."
fi

# ─── Go tooling (CONTRIBUTING.md "go install" lines) ──────────────────
log "Go tools: gofumpt, goimports-reviser, shfmt, govulncheck, deadcode, actionlint, gosec, wails, golangci-lint"
# golangci-lint via go install matches what ci.yml does (so the version
# Go-compiled-this-Go-toolchain matches; pre-built binaries are usually
# built against older Go).
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
go install mvdan.cc/gofumpt@latest
go install github.com/incu6us/goimports-reviser/v3@latest
# shfmt: required by `make fmt-shell` and `make lint-shell` (shellcheck + shfmt diff).
# Installed via go install here to match what ci.yml does.
go install mvdan.cc/sh/v3/cmd/shfmt@latest
go install golang.org/x/vuln/cmd/govulncheck@latest
go install golang.org/x/tools/cmd/deadcode@latest
# actionlint: GitHub Actions workflow linter. Used by `make lint-actions`
# and the lefthook pre-push hook.
go install github.com/rhysd/actionlint/cmd/actionlint@latest
# gosec: Go SAST. Used by `make lint-gosec` and the CI security job.
# Pinned so dev / CI / lefthook all run the same gosec version.
go install "github.com/securego/gosec/v2/cmd/gosec@${GOSEC_VERSION}"
go install "github.com/wailsapp/wails/v2/cmd/wails@${WAILS_VERSION}"

# ─── hadolint (Dockerfile linter) ─────────────────────────────────────
log "hadolint ${HADOLINT_VERSION}"
sudo curl -fsSL "https://github.com/hadolint/hadolint/releases/download/${HADOLINT_VERSION}/hadolint-Linux-x86_64" \
    -o /usr/local/bin/hadolint
sudo chmod +x /usr/local/bin/hadolint

# ─── lefthook (pre-commit hooks runner) ───────────────────────────────
log "lefthook ${LEFTHOOK_VERSION}"
curl -fsSL "https://github.com/evilmartians/lefthook/releases/download/v${LEFTHOOK_VERSION}/lefthook_${LEFTHOOK_VERSION}_Linux_x86_64.tar.gz" \
    | sudo tar -xz -C /usr/local/bin lefthook
sudo chmod +x /usr/local/bin/lefthook

# ─── trivy (vulnerability scanner) ────────────────────────────────────
log "trivy ${TRIVY_VERSION}"
curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
    | sudo tar -xz -C /usr/local/bin trivy
sudo chmod +x /usr/local/bin/trivy

# ─── typos (spell-checker) ────────────────────────────────────────────
log "typos ${TYPOS_VERSION}"
curl -fsSL "https://github.com/crate-ci/typos/releases/download/${TYPOS_VERSION}/typos-${TYPOS_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | sudo tar -xz -C /usr/local/bin ./typos
sudo chmod +x /usr/local/bin/typos

# ─── semgrep (JS/TS SAST) ─────────────────────────────────────────────
# Python-based — install via pipx so the binary lands on PATH without
# polluting the system Python. Matches how CI installs it; the version
# pin keeps dev / CI / lefthook in lockstep.
log "semgrep ${SEMGREP_VERSION}"
pipx install "semgrep==${SEMGREP_VERSION}"

# ─── direnv shell hook ────────────────────────────────────────────────
# The Dev Containers spec gives the `vscode` user a bash login shell.
# Wire direnv into it so cd-ing into the workspace activates .envrc.
log "direnv: bash hook"
if ! grep -q 'direnv hook bash' "$HOME/.bashrc" 2>/dev/null; then
    printf '\n# direnv (post-create)\neval "$(direnv hook bash)"\n' >> "$HOME/.bashrc"
fi
# direnv refuses to load .envrc until allowed once per machine; do it
# now so the container is usable out of the box.
if [ -f /workspaces/recall/.envrc ]; then
    direnv allow /workspaces/recall || true
fi

# ─── Frontend deps + git hooks ────────────────────────────────────────
log "frontend: npm ci"
( cd /workspaces/recall/frontend && npm ci --no-audit --no-fund )

log "lefthook install (wires .git/hooks/{pre-commit,commit-msg})"
( cd /workspaces/recall && lefthook install )

# ─── Sanity: report installed versions ────────────────────────────────
log "done — tool versions:"
{
    printf '  go             %s\n' "$(go version)"
    printf '  node           %s\n' "$(node --version)"
    printf '  tesseract      %s\n' "$(tesseract --version 2>&1 | head -1)"
    printf '  golangci-lint  %s\n' "$(golangci-lint --version 2>&1 | head -1)"
    printf '  gofumpt        %s\n' "$(gofumpt --version)"
    printf '  shfmt          %s\n' "$(shfmt --version)"
    printf '  wails          %s\n' "$(wails -v 2>&1 | head -1)"
    printf '  hadolint       %s\n' "$(hadolint --version)"
    printf '  yamllint       %s\n' "$(yamllint --version)"
    printf '  lefthook       %s\n' "$(lefthook version)"
    printf '  trivy          %s\n' "$(trivy --version 2>&1 | head -1)"
    printf '  typos          %s\n' "$(typos --version 2>&1 | head -1)"
    printf '  actionlint     %s\n' "$(actionlint -version 2>&1 | head -1)"
    printf '  gosec          %s\n' "$(gosec -version 2>&1 | head -1)"
    printf '  jq             %s\n' "$(jq --version)"
    printf '  direnv         %s\n' "$(direnv --version)"
} || true

cat <<'EOF'

────────────────────────────────────────────────────────────────────
Recall devcontainer ready.

Next steps:
  • The Wails GUI (`make dev`) won't run here — the container has no
    display surface. Use server mode instead:
        go run -tags serveronly . --server
    then open http://127.0.0.1:7000 (port-forwarded automatically).
    For a native Wails window, develop on a macOS or Debian/Ubuntu host
    (both run `make dev`); `make build-mac` also needs a macOS host.

  • Lint/test before committing:
        make lint    # golangci-lint, ESLint+typescript-eslint, Stylelint, HTMLHint, shellcheck+shfmt, Hadolint, yamllint, Spectral
        make test    # Go + Vitest

  • API spec change?  Regenerate types:
        make gen-types && make typecheck

  • Pre-commit hooks are installed.  Skip per-commit with:
        LEFTHOOK=0 git commit ...

See CONTRIBUTING.md for the full procedure.
────────────────────────────────────────────────────────────────────
EOF
