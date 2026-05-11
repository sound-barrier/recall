# OWMetrics — Homebrew dependencies for `wails dev`.
#
# Install with:  brew bundle
# Update with:   brew bundle --upgrade
# Check status:  brew bundle check

# Go toolchain. Project requires Go 1.25+ (see go.mod).
brew "go"

# Node.js (provides npm). Wails uses Vite + npm for the frontend.
brew "node"

# Tesseract OCR engine. The parser shells out to the `tesseract` CLI on PATH
# to read text from screenshots.
brew "tesseract"

# --- Not in brew, but required:
#
#   Wails CLI itself is a Go binary. Install once after `brew bundle`:
#     go install github.com/wailsapp/wails/v2/cmd/wails@latest
#
#   Confirm everything is set up:
#     wails doctor
