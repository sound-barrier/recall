# Recall — Homebrew dependencies for `wails dev`.
#
# Install with:  brew bundle
# Update with:   brew bundle --upgrade
# Check status:  brew bundle check

# Go toolchain. Project requires Go 1.26+ (see go.mod).
brew "go"

# Node.js (provides npm + npx). Wails uses Vite + npm for the frontend;
# `make lint-openapi` invokes Spectral via `npx --yes
# @stoplight/spectral-cli@<pinned>`.
brew "node"

# Tesseract OCR engine. The parser shells out to the `tesseract` CLI on PATH
# to read text from screenshots.
brew "tesseract"

# Container runtime + compose for the bundled Prometheus + Grafana stack
# AND for `make swagger` (which runs swaggerapi/swagger-ui in a container
# pointed at api/openapi.yaml). Podman is what we test against; the
# compose file is plain v3 so Docker (with Colima or Desktop) also works
# if you prefer — pass `DOCKER=docker` to any container-using make target.
brew "podman"
brew "podman-compose"

# JSON processing. verify-stack.sh requires jq to parse Prometheus API
# responses; db-show.sh uses it for pretty-printing when available.
brew "jq"

# Linting + formatting tools (used by `make lint` and `make fmt`).
#
# Brew covers six of the linters/formatters:
#   - golangci-lint (Go)
#   - hadolint      (Dockerfile)
#   - yamllint      (YAML)
#   - shellcheck    (bash scripts in scripts/ — driven by .shellcheckrc)
#   - shfmt         (bash formatter; same scope as shellcheck)
#   - (Spectral for OpenAPI runs via npx — see `node` above)
#
# The remaining three live under frontend/ and ship via npm:
#   - ESLint        (JS/Vue)
#   - Stylelint     (CSS)
#   - HTMLHint      (HTML)
# They're installed by `cd frontend && npm ci`, not by brew.
brew "golangci-lint"
brew "hadolint"
brew "yamllint"
brew "shellcheck"
brew "shfmt"

# Per-project environment variable loader (used with .envrc).
brew "direnv"

# Pre-commit hooks runner — installs git hooks defined in lefthook.yml.
# After `brew bundle`, run `lefthook install` once to wire the hooks
# into .git/hooks/. Skip per-commit with LEFTHOOK=0 git commit … .
brew "lefthook"

# Line-count tool (used by `make cloc`).
brew "cloc"

# Security scanning (used by `make trivy`).
brew "trivy"

# --- Not in brew, but required:
#
#   Wails CLI itself is a Go binary. Install once after `brew bundle`:
#     go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
#
#   Confirm everything is set up:
#     wails doctor
#
#   Go formatters (used by `make fmt`):
#     go install mvdan.cc/gofumpt@latest
#     go install github.com/incu6us/goimports-reviser/v3@latest
#
#   Dead code analysis (used by `make dead-code-go`):
#     go install golang.org/x/tools/cmd/deadcode@latest
#
# --- Not in brew, no install needed (handled on demand):
#
#   Spectral CLI       — fetched on demand by `npx --yes
#                        @stoplight/spectral-cli@<pinned>` from the
#                        lint-openapi make target.
#   Swagger UI         — pulled as the swaggerapi/swagger-ui:vX.Y.Z
#                        container image on first `make swagger`.
#   sqlite3 / sips     — pre-installed on macOS (/usr/bin/{sqlite3,sips});
#                        used by scripts/db-*.sh and `make icon`.
