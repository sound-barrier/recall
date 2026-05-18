# Recall — build targets
#
# Prerequisites (host):
#   Docker (or Podman aliased as docker) — for all Linux/Windows targets
#   Wails CLI + Xcode CLT + Go 1.26+    — for macOS Wails-app target only
#   Go 1.26+                             — for macOS server target (no Xcode needed)
#
# Quick start: make help

.DEFAULT_GOAL := help

DOCKER        ?= docker
DOCKERFILE    := Dockerfile.build
DIST_DIR      := dist
DIST_LINUX          := $(DIST_DIR)/linux
DIST_WINDOWS        := $(DIST_DIR)/windows
DIST_MAC            := $(DIST_DIR)/mac
DIST_SERVER_LINUX   := $(DIST_DIR)/server-linux
DIST_SERVER_WINDOWS := $(DIST_DIR)/server-windows
DIST_SERVER_MAC     := $(DIST_DIR)/server-mac

WAILS_FLAGS   := -trimpath

.PHONY: help \
        build-linux build-windows build-mac build-all build-all-docker \
        build-server-linux build-server-windows build-server-mac build-server-all \
        build-server-container \
        lint lint-go lint-js lint-css lint-html lint-docker \
        fmt update-deps trivy \
        dev clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} \
	    /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2 } \
	    /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' \
	    $(MAKEFILE_LIST)


##@ Wails desktop-app builds

build-linux: ## Linux/amd64 Wails app via Docker → dist/linux/Recall
	@echo "[ recall ] Building linux/amd64 Wails app via Docker…"
	@mkdir -p $(DIST_LINUX)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target linux-export \
	    --output type=local,dest=$(DIST_LINUX) \
	    .
	@echo "[ recall ] ✓  dist/linux/Recall"


build-windows: ## Windows/amd64 Wails app via Docker → dist/windows/Recall.exe
	@echo "[ recall ] Building windows/amd64 Wails app via Docker (mingw-w64)…"
	@mkdir -p $(DIST_WINDOWS)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target windows-export \
	    --output type=local,dest=$(DIST_WINDOWS) \
	    .
	@echo "[ recall ] ✓  dist/windows/"


# Apple SDK is not redistributable — must run on macOS with Xcode CLT.
# The npm/vite step is NOT skipped so Wails regenerates JS bindings.
# wails build always writes to build/bin/; we copy to dist/mac/ after.
build-mac: ## macOS arm64 Wails app → dist/mac/ (macOS host + Xcode CLT required)
	@if [ "$$(uname -s)" != "Darwin" ]; then \
	    echo "[ recall ] ✗  build-mac requires macOS (Apple SDK not redistributable)"; \
	    exit 1; \
	fi
	@echo "[ recall ] Building macOS Wails app (arm64)…"
	wails build $(WAILS_FLAGS) -platform darwin/arm64
	@mkdir -p $(DIST_MAC)
	@cp -R build/bin/Recall-arm64.app $(DIST_MAC)/
	@echo "[ recall ] ✓  dist/mac/Recall-arm64.app"


build-all-docker: build-linux build-windows ## Linux + Windows Wails apps via Docker
build-all: build-linux build-windows build-mac ## All three Wails platforms (macOS host required)


##@ Server-only builds (pure Go, CGO_ENABLED=0, -tags serveronly)

build-server-linux: ## Linux/amd64 server binary via Docker → dist/server-linux/Recall-server
	@echo "[ recall ] Building linux/amd64 server binary via Docker…"
	@mkdir -p $(DIST_SERVER_LINUX)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target server-linux-export \
	    --output type=local,dest=$(DIST_SERVER_LINUX) \
	    .
	@echo "[ recall ] ✓  dist/server-linux/Recall-server"


build-server-windows: ## Windows/amd64 server binary via Docker → dist/server-windows/Recall-server.exe
	@echo "[ recall ] Building windows/amd64 server binary via Docker…"
	@mkdir -p $(DIST_SERVER_WINDOWS)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target server-windows-export \
	    --output type=local,dest=$(DIST_SERVER_WINDOWS) \
	    .
	@echo "[ recall ] ✓  dist/server-windows/Recall-server.exe"


# Unlike the Wails .app, server binary is pure-Go so Docker can
# cross-compile it on Linux — no Apple SDK required.
build-server-mac: ## macOS arm64 server binary via Docker → dist/server-mac/
	@echo "[ recall ] Building macOS server binary (arm64) via Docker…"
	@mkdir -p $(DIST_SERVER_MAC)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target server-mac-export \
	    --output type=local,dest=$(DIST_SERVER_MAC) \
	    .
	@echo "[ recall ] ✓  dist/server-mac/Recall-server-arm64"


build-server-all: build-server-linux build-server-windows build-server-mac ## All three server binaries via Docker


build-server-container: ## Linux server container image with Tesseract → recall-server:local
	@echo "[ recall ] Building linux/amd64 server container image…"
	$(DOCKER) build \
	    --platform linux/amd64 \
	    --file $(DOCKERFILE) \
	    --target server-container \
	    --tag recall-server:local \
	    .
	@echo "[ recall ] ✓  recall-server:local"


##@ Quality

lint: lint-go lint-js lint-css lint-html lint-docker ## Run all linters

lint-go: ## Lint Go source (golangci-lint, both build tags)
	@echo "[ recall ] Linting Go (golangci-lint)…"
	golangci-lint run ./...
	golangci-lint run --build-tags serveronly ./...
	@echo "[ recall ] ✓  Go lint clean"

lint-js: ## Lint JavaScript/Vue (eslint)
	@echo "[ recall ] Linting JavaScript/Vue (eslint)…"
	cd frontend && npm run lint:js
	@echo "[ recall ] ✓  JS/Vue lint clean"

lint-css: ## Lint CSS (stylelint)
	@echo "[ recall ] Linting CSS (stylelint)…"
	cd frontend && npm run lint:css
	@echo "[ recall ] ✓  CSS lint clean"

lint-html: ## Lint HTML (htmlhint)
	@echo "[ recall ] Linting HTML (htmlhint)…"
	cd frontend && npm run lint:html
	@echo "[ recall ] ✓  HTML lint clean"

lint-docker: ## Lint Dockerfile.build (hadolint)
	@echo "[ recall ] Linting Dockerfile (hadolint)…"
	hadolint $(DOCKERFILE)
	@echo "[ recall ] ✓  Dockerfile lint clean"

fmt: ## Format Go source files
	@echo "[ recall ] Formatting Go source files…"
	go fmt ./...
	@echo "[ recall ] ✓  Go source formatted"


##@ Maintenance

update-deps: ## Update Go modules and npm packages
	@echo "[ recall ] Updating Go module dependencies…"
	go get -u ./...
	go mod tidy
	@echo "[ recall ] Updating frontend npm dependencies…"
	cd frontend && npm update
	@echo "[ recall ] ✓  Dependencies updated"

trivy: ## Trivy vulnerability scan (fails on HIGH/CRITICAL)
	@echo "[ recall ] Running Trivy vulnerability scan…"
	trivy fs --scanners vuln --exit-code 1 --severity HIGH,CRITICAL .
	@echo "[ recall ] ✓  No HIGH/CRITICAL vulnerabilities found"

dev: ## Start hot-reload Wails dev server (macOS only)
	@if [ "$$(uname -s)" != "Darwin" ]; then \
	    echo "[ recall ] ✗  dev server requires macOS (Wails desktop shell)"; \
	    exit 1; \
	fi
	wails dev

clean: ## Remove dist/, build/bin/, frontend/dist, frontend/node_modules
	rm -rf $(DIST_DIR) build/bin frontend/dist frontend/node_modules
	@echo "[ recall ] dist/, build/bin/, frontend/dist, frontend/node_modules removed"
