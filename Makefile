# Recall — build targets
#
# Prerequisites (host):
#   Docker (or Podman aliased as docker) — for Linux + Windows targets
#   Wails CLI + Xcode CLT + Go 1.26+    — for the macOS target (macOS only)
#
# Quick start:
#   make build-linux    — produces dist/linux/Recall
#   make build-windows  — produces dist/windows/Recall.exe (+ NSIS installer)
#   make build-mac      — produces build/bin/Recall.app (must run on macOS)
#   make build-all      — all three above in sequence
#   make dev            — hot-reload dev server (macOS only)
#   make clean          — remove dist/

.PHONY: build-linux build-windows build-mac build-all build-all-docker dev clean

DOCKER        ?= docker
DOCKERFILE    := Dockerfile.build
DIST_DIR      := dist
DIST_LINUX    := $(DIST_DIR)/linux
DIST_WINDOWS  := $(DIST_DIR)/windows
DIST_MAC      := $(DIST_DIR)/mac

# wails build flags common to native builds
WAILS_FLAGS   := -trimpath

# ─── Linux ──────────────────────────────────────────────────
# Runs entirely inside Docker; output is a single static-ish ELF
# binary at dist/linux/Recall.
build-linux:
	@echo "[ recall ] Building linux/amd64 via Docker…"
	@mkdir -p $(DIST_LINUX)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target linux-export \
	    --output type=local,dest=$(DIST_LINUX) \
	    .
	@echo "[ recall ] ✓  dist/linux/Recall"


# ─── Windows ────────────────────────────────────────────────
# Cross-compiled from Linux via mingw-w64 inside Docker.
# Produces Recall.exe and an optional NSIS installer if nsis is
# available in the container (controlled by the -nsis Wails flag).
build-windows:
	@echo "[ recall ] Building windows/amd64 via Docker (mingw-w64 cross-compiler)…"
	@mkdir -p $(DIST_WINDOWS)
	$(DOCKER) build \
	    --file $(DOCKERFILE) \
	    --target windows-export \
	    --output type=local,dest=$(DIST_WINDOWS) \
	    .
	@echo "[ recall ] ✓  dist/windows/"


# ─── macOS ──────────────────────────────────────────────────
# Apple's SDK is not redistributable, so macOS builds must run on a
# Mac with Xcode Command Line Tools installed. This target checks
# before trying.
#
# NOTE: wails build always writes to build/bin/; this target moves
# the resulting .app bundle to dist/mac/ after the build completes.
# The npm/vite step is NOT skipped (-s is absent) so the JS bindings
# for any new Wails methods are regenerated automatically.
build-mac:
	@if [ "$$(uname -s)" != "Darwin" ]; then \
	    echo "[ recall ] ✗  build-mac must run on macOS (Apple SDK required)"; \
	    exit 1; \
	fi
	@echo "[ recall ] Building darwin/universal (arm64 + amd64)…"
	wails build $(WAILS_FLAGS) -platform darwin/arm64,darwin/amd64
	@mkdir -p $(DIST_MAC)
	@cp -R build/bin/Recall.app $(DIST_MAC)/
	@echo "[ recall ] ✓  dist/mac/Recall.app"


# ─── All platforms ──────────────────────────────────────────
# build-all runs all three; use build-all-docker on non-macOS hosts.
build-all: build-linux build-windows build-mac
build-all-docker: build-linux build-windows


# ─── Dev ────────────────────────────────────────────────────
dev:
	@if [ "$$(uname -s)" != "Darwin" ]; then \
	    echo "[ recall ] ✗  dev server requires macOS (Wails desktop shell)"; \
	    exit 1; \
	fi
	wails dev


# ─── Clean ──────────────────────────────────────────────────
clean:
	rm -rf $(DIST_DIR)
	@echo "[ recall ] dist/ removed"
