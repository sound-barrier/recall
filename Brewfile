# Recall — Homebrew dependencies for `wails dev`.
#
# Install with:  brew bundle
# Update with:   brew bundle --upgrade
# Check status:  brew bundle check

# Go toolchain. Project requires Go 1.26+ (see go.mod).
brew "go"

# Node.js (provides npm). Wails uses Vite + npm for the frontend.
brew "node"

# Tesseract OCR engine. The parser shells out to the `tesseract` CLI on PATH
# to read text from screenshots.
brew "tesseract"

# Container runtime + compose for the bundled Prometheus + Grafana stack.
# Podman is what we test against; the compose file is plain v3 so Docker
# (with Colima or Desktop) also works if you prefer.
brew "podman"
brew "podman-compose"

# JSON processing. verify-stack.sh requires jq to parse Prometheus API
# responses; db-show.sh uses it for pretty-printing when available.
brew "jq"

# Linting tools (used by `make lint`).
brew "golangci-lint"
brew "hadolint"

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
