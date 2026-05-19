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
	@cp -R build/bin/Recall.app $(DIST_MAC)/Recall-arm64.app
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

cloc: ## Count lines of source code (excludes deps, build artifacts, generated files)
	cloc . \
	    --exclude-dir=node_modules,dist,build,wailsjs,data,recall,vendor \
	    --not-match-f='(go\.sum|package-lock\.json)'

lint: lint-go lint-js lint-css lint-html lint-docker lint-yaml lint-openapi ## Run all linters

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

lint-yaml: ## Lint YAML files (yamllint)
	@echo "[ recall ] Linting YAML…"
	yamllint .
	@echo "[ recall ] ✓  YAML lint clean"

# Spectral runs the spectral:oas ruleset against api/openapi.yaml; see
# .spectral.yaml at the project root for rule overrides. npx pulls a
# pinned version on demand so no global install is required.
SPECTRAL ?= npx --yes @stoplight/spectral-cli@6.14.2

lint-openapi: ## Lint api/openapi.yaml (Spectral, spectral:oas ruleset)
	@echo "[ recall ] Linting OpenAPI (spectral)…"
	$(SPECTRAL) lint api/openapi.yaml --fail-severity=warn
	@echo "[ recall ] ✓  OpenAPI lint clean"

# Regenerate frontend/src/api.gen.d.ts from the OpenAPI spec. Run after
# every change to api/openapi.yaml. The .d.ts is checked in so IDEs
# (and tsc) can resolve types without a build step.
gen-types: ## Regenerate frontend/src/api.gen.d.ts from api/openapi.yaml
	@echo "[ recall ] Regenerating frontend TypeScript types from OpenAPI…"
	cd frontend && npm run gen:types
	@echo "[ recall ] ✓  frontend/src/api.gen.d.ts updated"

typecheck: ## TypeScript type-check (frontend api.ts + api.gen.d.ts)
	@echo "[ recall ] Type-checking frontend (tsc --noEmit)…"
	cd frontend && npm run typecheck
	@echo "[ recall ] ✓  TypeScript clean"

fmt: ## Format Go source files (goimports-reviser + gofumpt)
	@echo "[ recall ] Formatting Go source files…"
	goimports-reviser -rm-unused -use-cache -project-name recall -output write ./...
	gofumpt -l -w .
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

##@ Test

test: test-go test-frontend ## Run all tests

test-go: ## Run Go unit tests (skips parser golden-file tests in -short mode)
	@echo "[ recall ] Running Go unit tests…"
	go test ./...
	@echo "[ recall ] ✓  Go tests passed"

test-frontend: ## Run frontend unit tests (Vitest)
	@echo "[ recall ] Running frontend unit tests (Vitest)…"
	cd frontend && npm run test
	@echo "[ recall ] ✓  Frontend tests passed"

# Sync the app icon. Source of truth: assets/icon.png. Wails reads
# build/appicon.png at 1024x1024 and auto-generates iconfile.icns (macOS)
# + icon.ico (Windows) during `wails build`, so clearing the cached .ico
# forces it to regenerate from the new appicon on the next build.
icon: ## Resync build/appicon.png from assets/icon.png (run after updating the icon)
	@if [ ! -f assets/icon.png ]; then \
	    echo "[ recall ] ✗  assets/icon.png not found"; exit 1; \
	fi
	@if ! command -v sips >/dev/null 2>&1; then \
	    echo "[ recall ] ✗  sips not found (macOS only); resize assets/icon.png to 1024x1024 manually and copy to build/appicon.png"; \
	    exit 1; \
	fi
	@sips -z 1024 1024 assets/icon.png --out build/appicon.png >/dev/null
	@rm -f build/windows/icon.ico
	@echo "[ recall ] ✓  build/appicon.png updated · build/windows/icon.ico cleared (regenerates on next wails build)"

dev: ## Start hot-reload Wails dev server (macOS only)
	@if [ "$$(uname -s)" != "Darwin" ]; then \
	    echo "[ recall ] ✗  dev server requires macOS (Wails desktop shell)"; \
	    exit 1; \
	fi
	wails dev

# Spec at api/openapi.yaml (hand-written OpenAPI 3.1.0). Served by the
# official Swagger UI container — mounted read-only so editing the file
# auto-refreshes on browser reload. Stops on Ctrl-C and removes the
# container. Honors the $(DOCKER) override (set DOCKER=podman for Podman).
SWAGGER_PORT  ?= 8080
SWAGGER_IMAGE ?= swaggerapi/swagger-ui:v5.17.14

swagger: ## Serve api/openapi.yaml via Swagger UI on :$(SWAGGER_PORT) (Ctrl-C to stop)
	@if [ ! -f api/openapi.yaml ]; then \
	    echo "[ recall ] ✗  api/openapi.yaml not found"; exit 1; \
	fi
	@echo "[ recall ] Swagger UI on http://localhost:$(SWAGGER_PORT)/  (Ctrl-C to stop)"
	@$(DOCKER) run --rm -it \
	    --name recall-swagger \
	    -p $(SWAGGER_PORT):8080 \
	    -e SWAGGER_JSON=/spec/openapi.yaml \
	    -v "$(CURDIR)/api/openapi.yaml:/spec/openapi.yaml:ro" \
	    $(SWAGGER_IMAGE)

clean: ## Remove dist/, build/bin/, frontend/dist, frontend/node_modules
	rm -rf $(DIST_DIR) build/bin frontend/dist frontend/node_modules
	@echo "[ recall ] dist/, build/bin/, frontend/dist, frontend/node_modules removed"
