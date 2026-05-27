# Recall — build targets
#
# Prerequisites (host):
#   Docker (or Podman aliased as docker) — for all Linux/Windows targets
#   Wails CLI + Xcode CLT + Go 1.26+    — for macOS Wails-app target only
#   Go 1.26+                             — for macOS server target (no Xcode needed)
#
# Quick start: make help

.DEFAULT_GOAL := help

# Pinned tool versions shared with lefthook, CI workflows, and the
# dev-environment install scripts. See tool-versions.env for the full
# list; `make check-deps` validates these against upstream releases.
include tool-versions.env

DOCKER        ?= docker
DOCKERFILE    := Dockerfile.build
DIST_DIR      := dist
DIST_LINUX          := $(DIST_DIR)/linux
DIST_WINDOWS        := $(DIST_DIR)/windows
DIST_MAC            := $(DIST_DIR)/mac
DIST_SERVER_LINUX   := $(DIST_DIR)/server-linux
DIST_SERVER_WINDOWS := $(DIST_DIR)/server-windows
DIST_SERVER_MAC     := $(DIST_DIR)/server-mac

BUILD_VERSION := $(shell jq -r '."."' .release-please-manifest.json 2>/dev/null || echo dev)
VERSION_LDFLAG := -X recall/pkg/app.Version=$(BUILD_VERSION)

WAILS_FLAGS   := -trimpath -ldflags "$(VERSION_LDFLAG)"

.PHONY: help init \
        build-linux build-windows build-mac build-all build-all-docker \
        build-server-linux build-server-windows build-server-mac build-server-all \
        build-server-container \
        lint lint-go lint-js lint-css lint-html lint-docker lint-typos lint-md lint-actions lint-gosec \
        dead-code dead-code-go dead-code-ts \
        test test-go test-frontend test-e2e test-all update-goldens \
        cover cover-go cover-frontend \
        fmt update-deps trivy check-deps \
        cloc cloc-detail \
        pages-build pages-preview \
        dev clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} \
	    /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2 } \
	    /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' \
	    $(MAKEFILE_LIST)

init: ## One-shot setup for a fresh clone — runs ./initialize.sh (macOS or Debian/Ubuntu)
	./initialize.sh


##@ Wails desktop-app builds

build-linux: ## Linux/amd64 Wails app via Docker → dist/linux/Recall
	@echo "[ recall ] Building linux/amd64 Wails app via Docker…"
	@mkdir -p $(DIST_LINUX)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --build-arg VERSION=$(BUILD_VERSION) \
	    --target linux-export \
	    --output type=local,dest=$(DIST_LINUX) \
	    .
	@echo "[ recall ] ✓  dist/linux/Recall"


build-windows: ## Windows/amd64 Wails app + NSIS installer via Docker → dist/windows/
	@echo "[ recall ] Building windows/amd64 Wails app + NSIS installer via Docker (mingw-w64 + nsis)…"
	@mkdir -p $(DIST_WINDOWS)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --build-arg VERSION=$(BUILD_VERSION) \
	    --target windows-export \
	    --output type=local,dest=$(DIST_WINDOWS) \
	    .
	@echo "[ recall ] ✓  dist/windows/Recall.exe + dist/windows/Recall-amd64-installer.exe"


# Apple SDK is not redistributable — must run on macOS with Xcode CLT.
# The npm/vite step is NOT skipped so Wails regenerates JS bindings.
# wails build always writes to build/bin/; we copy to dist/mac/ after.
build-mac: ## macOS arm64 Wails app → dist/mac/Recall.app (macOS host + Xcode CLT required)
	@if [ "$$(uname -s)" != "Darwin" ]; then \
	    echo "[ recall ] ✗  build-mac requires macOS (Apple SDK not redistributable)"; \
	    exit 1; \
	fi
	@echo "[ recall ] Building macOS Wails app (arm64)…"
	wails build $(WAILS_FLAGS) -platform darwin/arm64
	@mkdir -p $(DIST_MAC)
	@rm -rf $(DIST_MAC)/Recall.app
	@cp -R build/bin/Recall.app $(DIST_MAC)/Recall.app
	@echo "[ recall ] ✓  dist/mac/Recall.app"


build-all-docker: build-linux build-windows ## Linux + Windows Wails apps via Docker
build-all: build-linux build-windows build-mac ## All three Wails platforms (macOS host required)


##@ Server-only builds (pure Go, CGO_ENABLED=0, -tags serveronly)

build-server-linux: ## Linux/amd64 server binary via Docker → dist/server-linux/Recall-server
	@echo "[ recall ] Building linux/amd64 server binary via Docker…"
	@mkdir -p $(DIST_SERVER_LINUX)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --build-arg VERSION=$(BUILD_VERSION) \
	    --target server-linux-export \
	    --output type=local,dest=$(DIST_SERVER_LINUX) \
	    .
	@echo "[ recall ] ✓  dist/server-linux/Recall-server"


build-server-windows: ## Windows/amd64 server binary via Docker → dist/server-windows/Recall-server.exe
	@echo "[ recall ] Building windows/amd64 server binary via Docker…"
	@mkdir -p $(DIST_SERVER_WINDOWS)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --build-arg VERSION=$(BUILD_VERSION) \
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
	    --build-arg VERSION=$(BUILD_VERSION) \
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
	    --build-arg VERSION=$(BUILD_VERSION) \
	    --target server-container \
	    --tag recall-server:local \
	    .
	@echo "[ recall ] ✓  recall-server:local"


##@ Quality

cloc: ## Count lines of source code, summary table (config in .clocrc)
	@command -v cloc >/dev/null || { echo "cloc not installed — brew install cloc (or apt install cloc)"; exit 1; }
	cloc --config .clocrc .

cloc-detail: ## Count lines of source code, per-file breakdown
	@command -v cloc >/dev/null || { echo "cloc not installed — brew install cloc (or apt install cloc)"; exit 1; }
	cloc --config .clocrc --by-file-by-lang .

lint: lint-go lint-js lint-css lint-html lint-shell lint-docker lint-yaml lint-openapi lint-typos lint-md lint-actions lint-gosec lint-semgrep ## Run all linters

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

# All shell scripts under scripts/ are bash. shellcheck honors the
# .shellcheckrc at the project root (source-path=SCRIPTDIR), which is
# what lets `# shellcheck source=_lib.sh` directives resolve correctly
# when invoking from the repo root. shfmt enforces the same
# 2-space / indent-switch / binary-op-at-line-start style we
# normalized to in commit ___ — `make fmt-shell` rewrites in place,
# `make lint-shell` runs shfmt in diff mode + shellcheck.
SHELL_SCRIPTS := $(wildcard scripts/*.sh) $(wildcard scripts/release/*.sh) $(wildcard scripts/release/smoke/*.sh)

lint-shell: ## Lint shell scripts (shellcheck + shfmt diff)
	@echo "[ recall ] Linting shell scripts (shellcheck)…"
	shellcheck $(SHELL_SCRIPTS)
	@echo "[ recall ] Checking shell formatting (shfmt -d)…"
	shfmt -d -i 2 -ci -bn $(SHELL_SCRIPTS)
	@echo "[ recall ] ✓  Shell lint clean"

lint-yaml: ## Lint YAML files (yamllint)
	@echo "[ recall ] Linting YAML…"
	yamllint .
	@echo "[ recall ] ✓  YAML lint clean"

# typos respects .gitignore by default; `_typos.toml` at the repo root
# excludes auto-generated files (CHANGELOG.md, frontend/wailsjs/) and
# lockfiles, and whitelists "mis"/"unparseable" which trip the default
# dictionary as false positives.
lint-typos: ## Spell-check via typos (config in _typos.toml)
	@command -v typos >/dev/null || { echo "[ recall ] ✗  typos not installed — brew install typos-cli (or see initialize.sh for Debian)"; exit 1; }
	@echo "[ recall ] Spell-checking (typos)…"
	typos
	@echo "[ recall ] ✓  Spelling clean"

# markdownlint-cli2 covers README, CLAUDE.md, docs/, CONTRIBUTING.md,
# RELEASES.md, etc. Config in .markdownlint-cli2.yaml at the repo root —
# stylistic noise rules are disabled (long lines, bare URLs, inline
# HTML) so what remains catches real bugs (broken anchor links,
# missing alt text, undescriptive link text). `--fix` is safe for
# the autofix-friendly rules (MD031, MD022, MD004).
lint-md: ## Lint Markdown via markdownlint-cli2 (config in .markdownlint-cli2.yaml)
	@echo "[ recall ] Linting Markdown (markdownlint-cli2)…"
	@npx --yes markdownlint-cli2
	@echo "[ recall ] ✓  Markdown lint clean"

# actionlint catches GitHub Actions workflow bugs: syntax errors,
# deprecated action inputs, expression mistakes, plus embeds shellcheck
# for `run:` script bodies (script-injection patterns the
# security_reminder_hook also flags).
lint-actions: ## Lint .github/workflows/*.yml via actionlint + enforce SHA-pinned external actions
	@command -v actionlint >/dev/null || { echo "[ recall ] ✗  actionlint not installed — brew install actionlint (or see initialize.sh for Debian)"; exit 1; }
	@echo "[ recall ] Linting GitHub Actions workflows (actionlint)…"
	actionlint .github/workflows/*.yml
	@echo "[ recall ] Enforcing SHA-pinned external actions…"
	@bash scripts/check-action-pins.sh
	@echo "[ recall ] ✓  workflows clean + actions SHA-pinned"

# gosec Go-specific SAST. Sweeps both build tags so the Wails and
# serveronly code paths both get covered. -exclude-dir filters the
# stray frontend/node_modules/flatted/golang/pkg/flatted package
# that go list ./... otherwise pulls in (same reason `make
# dead-code-go` greps it out). False positives are annotated inline
# via `// #nosec Gxxx -- <reason>` rather than ignored globally.
lint-gosec: ## Go SAST via gosec (both build tags)
	@command -v gosec >/dev/null || { echo "[ recall ] ✗  gosec not installed — brew install gosec (or see initialize.sh for Debian)"; exit 1; }
	@echo "[ recall ] gosec (default build tags)…"
	gosec -exclude-dir=frontend ./...
	@echo "[ recall ] gosec (serveronly build tag)…"
	gosec -exclude-dir=frontend -tags=serveronly ./...
	@echo "[ recall ] ✓  gosec clean"

# Semgrep — JS/TS SAST equivalent to gosec. Sweeps frontend/src/ for
# eval / exec / innerHTML / hardcoded-secret / unsafe-regex / DOM-XSS
# patterns via the community-maintained rulesets (p/javascript +
# p/typescript + p/owasp-top-ten). The registry packs are fetched at
# scan time (needs internet); the CLI itself is version-pinned.
#
# .vue files aren't scanned — Semgrep's analyzer set is per-extension
# and .vue isn't supported as a first-class language. The main
# Vue-specific XSS risk (v-html) is covered by vue/no-v-html in
# eslint-plugin-vue, which runs in `make lint-js`. False positives
# can be silenced with `// nosemgrep` inline comments (per-rule:
# `// nosemgrep: rule-id`).
lint-semgrep: ## JS/TS SAST via Semgrep (frontend/src/, TypeScript only — .vue handled by eslint-plugin-vue)
	@command -v semgrep >/dev/null || { echo "[ recall ] ✗  semgrep not installed — brew install semgrep (or pipx install semgrep==$(SEMGREP_VERSION))"; exit 1; }
	@echo "[ recall ] semgrep (JS/TS SAST)…"
	semgrep scan \
		--config=p/javascript \
		--config=p/typescript \
		--config=p/owasp-top-ten \
		--error \
		--metrics=off \
		--quiet \
		frontend/src/
	@echo "[ recall ] ✓  semgrep clean"

# Spectral runs the spectral:oas ruleset against api/openapi.yaml; see
# .spectral.yaml at the project root for rule overrides. npx pulls a
# pinned version on demand so no global install is required. Version
# pin lives in tool-versions.env (SPECTRAL_VERSION).
SPECTRAL ?= npx --yes @stoplight/spectral-cli@$(SPECTRAL_VERSION)

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

##@ Dead code analysis

# deadcode does whole-program call-graph analysis — only run for the serveronly
# variant. The Wails variant registers App methods via reflection so deadcode
# would report them as unreachable even though they're live; golangci-lint
# `unused` already covers that variant. The check, including the allow-list
# of intentional unreachables, lives in scripts/deadcode-check.sh so Make,
# lefthook, and CI all run the same logic.
# Install once: go install golang.org/x/tools/cmd/deadcode@latest
dead-code: dead-code-go dead-code-ts ## Find unreachable Go functions and unused TypeScript exports

dead-code-go: ## Unreachable Go functions (deadcode, serveronly build tag)
	@echo "[ recall ] Scanning for dead Go code (deadcode -tags serveronly)…"
	@bash scripts/deadcode-check.sh
	@echo "[ recall ] ✓  No unexpected dead Go code"

dead-code-ts: ## Unused TypeScript exports and stale deps (knip)
	@echo "[ recall ] Scanning for dead TypeScript code (knip)…"
	cd frontend && npm run dead:ts
	@echo "[ recall ] ✓  No dead TypeScript code found"

fmt: fmt-go fmt-shell ## Format all source files (Go + shell scripts)

fmt-go: ## Format Go source files (goimports-reviser + gofumpt)
	@echo "[ recall ] Formatting Go source files…"
	goimports-reviser -rm-unused -use-cache -project-name recall -output write ./...
	gofumpt -l -w .
	@echo "[ recall ] ✓  Go source formatted"

fmt-shell: ## Format shell scripts in scripts/ (shfmt -w)
	@echo "[ recall ] Formatting shell scripts (shfmt)…"
	shfmt -w -i 2 -ci -bn $(SHELL_SCRIPTS)
	@echo "[ recall ] ✓  Shell scripts formatted"


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

check-deps: ## Check pinned tool versions against latest releases (read-only)
	@bash scripts/check-deps.sh

##@ Release

# Cut a prerelease via an empty signed commit with a Release-As: footer
# that release-please picks up. See RELEASES.md → "Cutting a prerelease".
#
# Usage:
#   make release-beta VERSION=0.0.13-beta.0
#
# Refuses non-hyphenated versions by default to prevent an accidental
# stable cut (release-please normally derives stable versions itself).
# Pass ALLOW_STABLE=1 to override when you genuinely want to force one
# (e.g. jumping straight to 1.0.0).
release-beta: ## Cut a prerelease (usage: make release-beta VERSION=0.0.13-beta.0)
	@if [ -z "$(VERSION)" ]; then \
	    echo "[ recall ] ✗  VERSION is required (e.g. make release-beta VERSION=0.0.13-beta.0)"; \
	    exit 2; \
	fi
	@case "$(VERSION)" in v*) \
	    echo "[ recall ] ✗  drop the leading v — VERSION must be the bare semver (got $(VERSION))"; \
	    exit 2;; esac
	@if [ -z "$(ALLOW_STABLE)" ]; then \
	    case "$(VERSION)" in *-*) ;; *) \
	        echo "[ recall ] ✗  $(VERSION) has no hyphen — that's a stable version."; \
	        echo "             Stable cuts happen automatically when release-please sees"; \
	        echo "             feat:/fix: commits; you should not force them through this"; \
	        echo "             target. If you really want to (e.g. forcing v1.0.0), rerun"; \
	        echo "             with ALLOW_STABLE=1."; \
	        exit 2;; esac; \
	fi
	@if [ -n "$$(git status --porcelain)" ]; then \
	    echo "[ recall ] ✗  working tree is dirty; commit or stash first"; \
	    exit 2; \
	fi
	git commit -s --allow-empty \
	    -m "chore: cut v$(VERSION)" \
	    -m "Release-As: $(VERSION)"
	@echo
	@echo "[ recall ] ✓  empty commit created. Next steps:"
	@echo "    1.  git push origin main"
	@echo "    2.  merge the release-please PR titled 'chore(main): release v$(VERSION)'"
	@echo "    3.  if RELEASE_PLEASE_TOKEN is configured, release.yml fires automatically."
	@echo "        Otherwise:  make release-fire TAG=v$(VERSION)"

# Manually fire release.yml on an existing tag — used when the tag was
# created by release-please via GITHUB_TOKEN (which doesn't trigger
# downstream workflows). See RELEASES.md → "When release.yml doesn't
# auto-fire".
#
# Usage:
#   make release-fire TAG=v0.0.13-beta.0
release-fire: ## Manually fire release.yml on an existing tag (usage: make release-fire TAG=v0.0.13-beta.0)
	@if [ -z "$(TAG)" ]; then \
	    echo "[ recall ] ✗  TAG is required (e.g. make release-fire TAG=v0.0.13-beta.0)"; \
	    exit 2; \
	fi
	@command -v gh >/dev/null 2>&1 || { \
	    echo "[ recall ] ✗  gh CLI not installed (brew install gh, then gh auth login)"; \
	    exit 2; \
	}
	@if ! git ls-remote --exit-code --tags origin "$(TAG)" >/dev/null 2>&1; then \
	    echo "[ recall ] ✗  tag $(TAG) not found on origin"; \
	    exit 2; \
	fi
	gh workflow run release.yml --ref "$(TAG)"
	@echo
	@echo "[ recall ] ✓  release.yml dispatched for $(TAG)."
	@echo "    Watch progress:  gh run list --workflow release.yml --limit 1"

##@ Test

test: test-go test-frontend ## Run all tests

test-go: ## Run Go unit tests with -race (skips parser golden-file tests in -short mode)
	@echo "[ recall ] Running Go unit tests…"
	go test -race ./...
	@echo "[ recall ] ✓  Go tests passed"

test-frontend: ## Run frontend unit tests (Vitest)
	@echo "[ recall ] Running frontend unit tests (Vitest)…"
	cd frontend && npm run test
	@echo "[ recall ] ✓  Frontend tests passed"

# E2E browser tests via Playwright. Build the serveronly binary
# (embeds frontend/dist) into /tmp/recall-e2e/, then let Playwright's
# webServer block boot it on :7099 with HOME=/tmp/recall-e2e so the
# suite never touches real ~/Library/Application Support/Recall data.
# `test:` umbrella stays Go + Vitest by default; opt in to E2E with
# this target (or `make test-all` which calls both).
E2E_HOME ?= /tmp/recall-e2e

# Parser golden-file fixtures live in the repo-root testdata/ directory.
# This target re-runs ParseScreenshot against each .png there and
# rewrites its sidecar .golden.json with the current parse result.
# Use after intentionally changing parser output (or to seed a new
# fixture's golden after dropping the PNG in). Eyeball the resulting
# JSON diff before committing.
#
# Override the dir with an ABSOLUTE path to point at an uncommitted set
# (e.g. your local screenshots/ stash). The test binary's cwd is
# pkg/parser/, so relative paths must resolve from there — easier to
# always pass an absolute path here:
#   make update-goldens RECALL_FIXTURE_DIR="$$PWD/screenshots"
update-goldens: ## Regenerate parser golden-file fixtures from current parse output
	@echo "[ recall ] Updating parser goldens from $(or $(RECALL_FIXTURE_DIR),testdata/)…"
	RECALL_FIXTURE_UPDATE=1 $(if $(RECALL_FIXTURE_DIR),RECALL_FIXTURE_DIR=$(RECALL_FIXTURE_DIR)) \
	    go test -run TestParseScreenshot_GoldenFiles ./pkg/parser/ -v
	@echo "[ recall ] ✓  Goldens updated — review the diff and commit"

test-e2e: ## E2E browser tests via Playwright (boots server in $(E2E_HOME) on :7099)
	@command -v npx >/dev/null || { echo "[ recall ] ✗  npx not installed — install Node 22+"; exit 1; }
	@echo "[ recall ] Building frontend (required for Go //go:embed)…"
	@cd frontend && npm run build >/dev/null
	@echo "[ recall ] Building serveronly binary → $(E2E_HOME)/recall-server…"
	@mkdir -p $(E2E_HOME)
	@go build -tags serveronly -o $(E2E_HOME)/recall-server .
	@echo "[ recall ] Installing Playwright chromium (skipped if cached)…"
	@cd frontend && npx playwright install chromium
	@echo "[ recall ] Running Playwright E2E suite…"
	cd frontend && npx playwright test
	@echo "[ recall ] ✓  E2E tests passed"

test-all: test test-e2e ## Run unit tests + E2E (everything)

smoke-release-scripts: ## Smoke-test scripts/release/*.sh in temp dirs (no real tag needed)
	@bash scripts/release/smoke/smoke.sh

cover: cover-go cover-frontend ## Generate Go + frontend coverage reports (umbrella)

# Floor for `make cover-go`. Tuned a few points below the current
# state (~48% as of v0.1.1) so genuine regressions fail while
# routine refactors that shuffle uncovered lines don't. Override on
# the CLI for ad-hoc runs (e.g. `make cover-go GO_COVERAGE_MIN=0`).
# Bumping this floor in a PR is the safest way to lock in new
# coverage as the project matures — every release is a chance to
# ratchet upward by `floor(current) - 2`.
GO_COVERAGE_MIN ?= 46

cover-go: ## Generate Go coverage report; fail if total < GO_COVERAGE_MIN (46)
	@echo "[ recall ] Generating Go coverage report…"
	@mkdir -p coverage/go
	go test -race -short -coverprofile=coverage/go/coverage.out ./...
	go tool cover -func=coverage/go/coverage.out | tee coverage/go/coverage.txt
	go tool cover -html=coverage/go/coverage.out -o coverage/go/coverage.html
	@pct=$$(awk '/^total:/ { gsub(/%/, "", $$NF); print $$NF }' coverage/go/coverage.txt); \
	 awk -v p="$$pct" -v m="$(GO_COVERAGE_MIN)" 'BEGIN { \
	   if (p+0 < m+0) { \
	     printf "[ recall ] ✗  Go coverage %.1f%% is below threshold %s%%\n", p, m; \
	     exit 1 \
	   } \
	   printf "[ recall ] ✓  Go coverage %.1f%% ≥ threshold %s%%\n", p, m \
	 }'
	@echo "[ recall ] ✓  Coverage report written to coverage/go/"

cover-frontend: ## Generate JS/TS coverage report (Vitest + V8; output → frontend/coverage/)
	@echo "[ recall ] Generating frontend coverage report…"
	cd frontend && npm run test:coverage
	@echo "[ recall ] ✓  Coverage report written to frontend/coverage/"

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

dev: ## Start hot-reload Wails dev server (macOS or Debian)
	@case "$$(uname -s)" in \
	    Darwin) wails dev ;; \
	    Linux)  wails dev -tags webkit2_4_1 ;; \
	    *) echo "[ recall ] ✗  wails dev needs macOS or a Debian/Ubuntu host (no display surface elsewhere)"; exit 1 ;; \
	esac
# webkit2_4_1 build tag matches what Dockerfile.build's linux-builder
# stage passes: Wails v2.12.0's pkg/assetserver/webview has CGo
# directives referencing webkit2gtk-4.0, but Debian bookworm+/Ubuntu
# 24.04+ only ship 4.1. The build tag steers Wails to 4.1 CGo paths;
# initialize.sh's Debian path also drops pkg-config shims for the
# 4.0 names as belt-and-suspenders.

# Spec at api/openapi.yaml (hand-written OpenAPI 3.1.0). Served by the
# official Swagger UI container — mounted read-only so editing the file
# auto-refreshes on browser reload. Stops on Ctrl-C and removes the
# container. Honors the $(DOCKER) override (set DOCKER=podman for Podman).
SWAGGER_PORT  ?= 8080
SWAGGER_IMAGE ?= swaggerapi/swagger-ui:v5.32.6

# Honkit pin lives in tool-versions.env (HONKIT_VERSION).
# .github/workflows/pages.yml reads from the same source so local
# previews build the same site the workflow deploys.
PAGES_PORT     ?= 4000

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

# pages-build mirrors the staging+build dance in
# .github/workflows/pages.yml so what you preview locally is what CI
# deploys. Source-of-truth is still the workflow — when adding a new
# chapter, update SUMMARY.md, the workflow's `Stage build directory`
# step, AND the cp list below in lock-step.
pages-build: ## Build the docs book + Swagger UI under dist/pages/ (mirrors CI)
	@command -v npx >/dev/null || { echo "[ recall ] ✗  npx not installed — install Node 22+"; exit 1; }
	@echo "[ recall ] Staging book/ + docs/ into dist/pages-stage/…"
	@rm -rf dist/pages dist/pages-stage
	@mkdir -p dist/pages-stage
	@cp -R book/. dist/pages-stage/
	@cp docs/install-macos.md        dist/pages-stage/install-macos.md
	@cp docs/install-linux.md        dist/pages-stage/install-linux.md
	@cp docs/install-windows.md      dist/pages-stage/install-windows.md
	@cp docs/how-it-works.md         dist/pages-stage/how-it-works.md
	@cp docs/settings-reference.md   dist/pages-stage/settings-reference.md
	@cp docs/filtering.md            dist/pages-stage/filtering.md
	@cp docs/unknown-screenshots.md  dist/pages-stage/unknown-screenshots.md
	@cp docs/server.md               dist/pages-stage/server.md
	@cp docs/docker.md               dist/pages-stage/docker.md
	@cp docs/grafana.md              dist/pages-stage/grafana.md
	@cp docs/feedback.md             dist/pages-stage/feedback.md
	@# Mirror testdata/ into the staged book so how-it-works.md's
	@# example-screenshot images resolve via the same `testdata/foo.png`
	@# relative path used in the README. Cheap (~5 MB total) and avoids
	@# coupling the docs to absolute raw.githubusercontent.com URLs that
	@# would 404 on every branch rename.
	@mkdir -p dist/pages-stage/testdata
	@cp testdata/*.png dist/pages-stage/testdata/
	@rm -f dist/pages-stage/.gitignore
	@echo "[ recall ] Running honkit@$(HONKIT_VERSION)…"
	@cd dist/pages-stage && npx --yes "honkit@$(HONKIT_VERSION)" build . _book >/dev/null
	@mkdir -p dist/pages/api
	@cp -R dist/pages-stage/_book/. dist/pages/
	@cp docs/api/index.html dist/pages/api/index.html
	@cp api/openapi.yaml    dist/pages/api/openapi.yaml
	@echo "[ recall ] ✓  Built dist/pages/  (book root + /api/ Swagger UI)"

pages-preview: pages-build ## Build then serve dist/pages/ on http://localhost:$(PAGES_PORT) (Ctrl-C to stop)
	@command -v python3 >/dev/null || { echo "[ recall ] ✗  python3 not installed"; exit 1; }
	@echo "[ recall ] Docs site on http://localhost:$(PAGES_PORT)/  (Ctrl-C to stop)"
	@cd dist/pages && python3 -m http.server $(PAGES_PORT) --bind 127.0.0.1

clean: ## Remove dist/, build/bin/, frontend/dist, frontend/node_modules, stray repo-root binaries
	rm -rf $(DIST_DIR) build/bin frontend/dist frontend/node_modules
	# Stray dev builds at repo root from ad-hoc `go build` / `wails build`
	# invocations. Real release artifacts live under dist/.
	rm -rf Recall Recall.exe Recall.app recall Recall-server Recall-server.exe recall-server
	@echo "[ recall ] dist/, build/bin/, frontend/dist, frontend/node_modules, stray repo-root binaries removed"
