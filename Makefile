# Recall — build targets
#
# Prerequisites (host):
#   Docker (or Podman aliased as docker) — for all Linux/Windows targets
#   Wails CLI + Xcode CLT + Go 1.26+    — for macOS Wails-app target only
#   Go 1.26+                             — for macOS server target (no Xcode needed)
#
# ─── Wails desktop-app targets ────────────────────────────────────────────
#   make build-linux          — Linux/amd64 Wails app  → dist/linux/Recall
#   make build-windows        — Windows/amd64 Wails app → dist/windows/Recall.exe
#   make build-mac            — macOS universal Wails app → dist/mac/Recall.app
#                               (must run on macOS; requires Xcode CLT)
#   make build-all-docker     — Linux + Windows Wails apps via Docker
#   make build-all            — all three platforms (macOS host required)
#
# ─── Server-only targets (pure Go, no WebView deps) ───────────────────────
#   make build-server-linux   — Linux/amd64 server  → dist/server-linux/Recall-server
#   make build-server-windows — Windows/amd64 server → dist/server-windows/Recall-server.exe
#   make build-server-mac     — macOS server binaries → dist/server-mac/
#                               arm64 + amd64 via Docker (no Apple SDK needed!)
#   make build-server-all          — all three server builds via Docker
#   make build-server-container    — Linux server container image (Tesseract included) → recall-server:local
#
# ─── Lint ─────────────────────────────────────────────────────────────────
#   make lint             — run all linters
#   make lint-go          — golangci-lint (both build tags)
#   make lint-js          — ESLint (JS + Vue)
#   make lint-css         — Stylelint
#   make lint-html        — HTMLHint
#   make lint-docker      — Hadolint (Dockerfile.build)
#
# ─── Other ────────────────────────────────────────────────────────────────
#   make dev                  — hot-reload Wails dev server (macOS only)
#   make clean                — remove dist/

.PHONY: build-linux build-windows build-mac build-all build-all-docker \
        build-server-linux build-server-windows build-server-mac build-server-all \
        build-server-container \
        lint lint-go lint-js lint-css lint-html lint-docker \
        dev clean

DOCKER        ?= docker
DOCKERFILE    := Dockerfile.build
DIST_DIR      := dist
DIST_LINUX          := $(DIST_DIR)/linux
DIST_WINDOWS        := $(DIST_DIR)/windows
DIST_MAC            := $(DIST_DIR)/mac
DIST_SERVER_LINUX   := $(DIST_DIR)/server-linux
DIST_SERVER_WINDOWS := $(DIST_DIR)/server-windows
DIST_SERVER_MAC     := $(DIST_DIR)/server-mac

# wails build flags for native macOS builds
WAILS_FLAGS   := -trimpath


# ════════════════════════════════════════════════════════════════
# WAILS DESKTOP APP BUILDS
# ════════════════════════════════════════════════════════════════

# ─── Linux Wails app ────────────────────────────────────────
build-linux:
	@echo "[ recall ] Building linux/amd64 Wails app via Docker…"
	@mkdir -p $(DIST_LINUX)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target linux-export \
	    --output type=local,dest=$(DIST_LINUX) \
	    .
	@echo "[ recall ] ✓  dist/linux/Recall"


# ─── Windows Wails app ──────────────────────────────────────
build-windows:
	@echo "[ recall ] Building windows/amd64 Wails app via Docker (mingw-w64)…"
	@mkdir -p $(DIST_WINDOWS)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target windows-export \
	    --output type=local,dest=$(DIST_WINDOWS) \
	    .
	@echo "[ recall ] ✓  dist/windows/"


# ─── macOS Wails app ────────────────────────────────────────
# Apple SDK is not redistributable — must run on macOS with Xcode CLT.
# The npm/vite step is NOT skipped so Wails regenerates JS bindings.
# wails build always writes to build/bin/; we copy to dist/mac/ after.
build-mac:
	@if [ "$$(uname -s)" != "Darwin" ]; then \
	    echo "[ recall ] ✗  build-mac requires macOS (Apple SDK not redistributable)"; \
	    exit 1; \
	fi
	@echo "[ recall ] Building macOS universal Wails app (arm64 + amd64)…"
	wails build $(WAILS_FLAGS) -platform darwin/arm64,darwin/amd64
	@mkdir -p $(DIST_MAC)
	@cp -R build/bin/Recall.app $(DIST_MAC)/
	@echo "[ recall ] ✓  dist/mac/Recall.app"


# ─── All Wails builds ───────────────────────────────────────
build-all-docker: build-linux build-windows
build-all: build-linux build-windows build-mac


# ════════════════════════════════════════════════════════════════
# SERVER-ONLY BUILDS  (pure Go, CGO_ENABLED=0, -tags serveronly)
# No WebView/GTK/Apple SDK needed. All three OS targets can be
# produced from Linux via Docker cross-compilation.
# ════════════════════════════════════════════════════════════════

# ─── Linux server binary ────────────────────────────────────
build-server-linux:
	@echo "[ recall ] Building linux/amd64 server binary via Docker…"
	@mkdir -p $(DIST_SERVER_LINUX)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target server-linux-export \
	    --output type=local,dest=$(DIST_SERVER_LINUX) \
	    .
	@echo "[ recall ] ✓  dist/server-linux/Recall-server"


# ─── Windows server binary ──────────────────────────────────
build-server-windows:
	@echo "[ recall ] Building windows/amd64 server binary via Docker…"
	@mkdir -p $(DIST_SERVER_WINDOWS)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target server-windows-export \
	    --output type=local,dest=$(DIST_SERVER_WINDOWS) \
	    .
	@echo "[ recall ] ✓  dist/server-windows/Recall-server.exe"


# ─── macOS server binaries (arm64 + amd64) ──────────────────
# Unlike the Wails .app, these are pure-Go so Docker can cross-compile
# them on Linux — no Apple SDK required.
build-server-mac:
	@echo "[ recall ] Building macOS server binaries (arm64 + amd64) via Docker…"
	@mkdir -p $(DIST_SERVER_MAC)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target server-mac-export \
	    --output type=local,dest=$(DIST_SERVER_MAC) \
	    .
	@echo "[ recall ] ✓  dist/server-mac/  (Recall-server-arm64, Recall-server-amd64)"


# ─── All server builds ──────────────────────────────────────
build-server-all: build-server-linux build-server-windows build-server-mac


# ─── Linux server container image (includes Tesseract runtime) ──────────────
build-server-container:
	@echo "[ recall ] Building linux/amd64 server container image…"
	$(DOCKER) buildx build \
	    --platform linux/amd64 \
	    --file $(DOCKERFILE) \
	    --target server-container \
	    --tag recall-server:local \
	    --load \
	    .
	@echo "[ recall ] ✓  recall-server:local"


# ════════════════════════════════════════════════════════════════
# LINT
# Requires: golangci-lint + hadolint on PATH (brew bundle)
#           npm install run in frontend/ (for ESLint, Stylelint, HTMLHint)
# ════════════════════════════════════════════════════════════════

lint: lint-go lint-js lint-css lint-html lint-docker

lint-go:
	@echo "[ recall ] Linting Go (golangci-lint)…"
	golangci-lint run ./...
	golangci-lint run --build-tags serveronly ./...
	@echo "[ recall ] ✓  Go lint clean"

lint-js:
	@echo "[ recall ] Linting JavaScript/Vue (eslint)…"
	cd frontend && npm run lint:js
	@echo "[ recall ] ✓  JS/Vue lint clean"

lint-css:
	@echo "[ recall ] Linting CSS (stylelint)…"
	cd frontend && npm run lint:css
	@echo "[ recall ] ✓  CSS lint clean"

lint-html:
	@echo "[ recall ] Linting HTML (htmlhint)…"
	cd frontend && npm run lint:html
	@echo "[ recall ] ✓  HTML lint clean"

lint-docker:
	@echo "[ recall ] Linting Dockerfile (hadolint)…"
	hadolint $(DOCKERFILE)
	@echo "[ recall ] ✓  Dockerfile lint clean"


# ════════════════════════════════════════════════════════════════
# DEV + UTILS
# ════════════════════════════════════════════════════════════════

dev:
	@if [ "$$(uname -s)" != "Darwin" ]; then \
	    echo "[ recall ] ✗  dev server requires macOS (Wails desktop shell)"; \
	    exit 1; \
	fi
	wails dev


clean:
	rm -rf $(DIST_DIR)
	@echo "[ recall ] dist/ removed"
