# Contributing

This guide covers setting up a local development environment, building the
project for all target platforms, and maintaining code quality. For an
overview of the architecture and internal conventions, see
[`CLAUDE.md`](CLAUDE.md).

## Table of Contents

- [Development setup](#development-setup)
  - [macOS](#macos)
  - [Linux](#linux)
  - [Windows](#windows)
    - [Option A: WSL2 (recommended)](#option-a-wsl2-recommended)
    - [Option B: Native Windows](#option-b-native-windows)
- [Building](#building)
  - [Wails desktop app](#wails-desktop-app)
  - [Server-only binary](#server-only-binary)
  - [Other build commands](#other-build-commands)
- [Maintenance](#maintenance)
- [API specification](#api-specification)

## Development setup

```sh
make help       # list all available targets
```

Two workflows exist depending on your platform:

| Workflow | Platforms | Entry point |
|---|---|---|
| `make dev` — Wails hot-reload | **macOS only** | Native WebKit window; Vite HMR on `:5173`, Wails IPC on `:34115`, Go rebuilt on save |
| Server mode — headless HTTP | macOS, Linux, Windows | `go run -tags serveronly . --server`; open `http://127.0.0.1:7000` in any browser |

### macOS

**One-time prerequisites:**

```sh
xcode-select --install          # Xcode Command Line Tools (required for Wails CGo builds)
brew bundle                     # Go, Node, Tesseract, Podman, golangci-lint, yamllint, direnv, etc.
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
go install mvdan.cc/gofumpt@latest
go install github.com/incu6us/goimports-reviser/v3@latest
direnv allow                    # activate the repo's .envrc (edit it to set any env overrides)
```

Add the direnv hook to your shell if you haven't already (`~/.zshrc` for zsh, `~/.bash_profile` for bash):

```sh
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc && source ~/.zshrc
# or for bash:
echo 'eval "$(direnv hook bash)"' >> ~/.bash_profile && source ~/.bash_profile
```

**First clone setup:**

```sh
cd frontend && npm ci && cd ..
rm -rf frontend/wailsjs/go/main/   # delete stale bindings (package moved main → app)
make dev                            # generates fresh bindings on first run
```

Re-run `wails dev` (or delete `frontend/wailsjs/go/app/App.js` and re-run) any time you add a new exported method to `App`.

**Day-to-day:**

```sh
make dev        # hot-reload Wails desktop app
make lint       # all linters before pushing
make fmt        # format Go source
wails doctor    # verify toolchain at any time
```

### Linux

`make dev` exits on non-Darwin hosts. Linux developers use **server mode** — the embedded Vue frontend is served over HTTP and works in any browser.

**One-time prerequisites** (Ubuntu/Debian — adapt for other distros):

```sh
# Go 1.26+ (distro packages are often older; official tarball is safest)
wget https://go.dev/dl/go1.26.3.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.26.3.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin:$(go env GOPATH)/bin' >> ~/.profile
source ~/.profile

# Node 26+
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
sudo apt install -y nodejs

# System tools
sudo apt install -y tesseract-ocr jq sqlite3 docker.io  # or podman

# Go-based tools
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
go install mvdan.cc/gofumpt@latest
go install github.com/incu6us/goimports-reviser/v3@latest

# hadolint (Dockerfile linter)
curl -L https://github.com/hadolint/hadolint/releases/latest/download/hadolint-Linux-x86_64 \
  | sudo tee /usr/local/bin/hadolint > /dev/null && sudo chmod +x /usr/local/bin/hadolint

# yamllint (YAML linter)
pip3 install yamllint  # or: sudo apt install yamllint

# direnv (per-project env vars)
sudo apt install direnv  # or: curl -sfL https://direnv.net/install.sh | bash
echo 'eval "$(direnv hook bash)"' >> ~/.bashrc && source ~/.bashrc

# trivy (vulnerability scanner)
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
  | sudo sh -s -- -b /usr/local/bin
```

After cloning, run `direnv allow` to activate the repo's `.envrc`.

**First clone setup:**

```sh
cd frontend && npm ci && cd ..
go build -tags serveronly ./...   # verify compile
```

**Day-to-day:**

```sh
# Run the server — open http://127.0.0.1:7000 in a browser
go run -tags serveronly . --server

# Linting
make lint

# Docker-based cross-platform builds (Docker or Podman)
make build-server-linux          # Linux server binary → dist/server-linux/
make build-server-all            # all three server OS targets via Docker
DOCKER=podman make build-linux   # swap in Podman
```

### Windows

`make dev` is macOS-only. The recommended path is **WSL2**, which gives you a complete Linux environment. Native Windows is also documented below.

#### Option A: WSL2 (recommended)

```powershell
# In PowerShell — one-time
wsl --install   # installs Ubuntu by default; reboot if prompted
```

Open the WSL2 terminal and follow the **Linux** instructions above.

#### Option B: Native Windows

**One-time prerequisites:**

- [Go 1.26+](https://go.dev/dl/) — use the `.msi` installer; confirm `go version` in a new shell
- [Node 26+](https://nodejs.org/) or [nvm-windows](https://github.com/coreybutler/nvm-windows)
- [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) — note the install path; paste it into **Settings → Engine** on first launch
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — needed for `make build-*` targets
- [Git for Windows](https://git-scm.com/download/win) — provides Git Bash; run all `make` commands from Git Bash
- `jq` — `winget install jqlang.jq`
- `golangci-lint` — `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`
- `gofumpt` — `go install mvdan.cc/gofumpt@latest`
- `goimports-reviser` — `go install github.com/incu6us/goimports-reviser/v3@latest`
- `hadolint` — `winget install Hadolint.Hadolint` or [download from GitHub releases](https://github.com/hadolint/hadolint/releases) (`hadolint-Windows-x86_64.exe`)
- `yamllint` — `pip install yamllint` (requires Python 3)
- `trivy` — `winget install AquaSecurity.Trivy` or [download from GitHub releases](https://github.com/aquasecurity/trivy/releases)

**First clone setup** (Git Bash):

```sh
cd frontend && npm ci && cd ..
go build -tags serveronly ./...   # verify compile
```

**Day-to-day** (Git Bash):

```sh
# Run the server — open http://127.0.0.1:7000 in a browser
go run -tags serveronly . --server

# Lint (Docker Desktop must be running for lint-docker)
make lint

# Docker-based builds
make build-server-windows
make build-server-all
```

## Building

Recall ships two binary flavours:

| Flavour | What it is | CGo? |
|---|---|---|
| **Wails app** | Native desktop window (WebKit/WebView2) | Yes — needs platform WebView libs |
| **Server** | Headless HTTP server (default `127.0.0.1:7000`, override with `RECALL_SERVER_ADDR`) | No — pure Go, cross-compilable anywhere |

### Wails desktop app

```sh
make build-linux        # Linux/amd64   → dist/linux/Recall
make build-windows      # Windows/amd64 → dist/windows/Recall.exe
make build-mac          # macOS arm64 .app → dist/mac/  (macOS host required)
make build-all-docker   # Linux + Windows via Docker (no Apple SDK needed)
make build-all          # all three (macOS host required)
```

Linux and Windows builds run in Docker (`Dockerfile.build`). macOS `.app` bundles
require Apple's SDK and must be built on a Mac — `make build-mac` exits on non-Darwin hosts.

### Server-only binary

The server binary (`-tags serveronly`) has no Wails or WebView dependency — it is pure Go.
All three OS targets can be produced from Docker on any host, including macOS.

```sh
make build-server-linux      # Linux/amd64     → dist/server-linux/Recall-server
make build-server-windows    # Windows/amd64   → dist/server-windows/Recall-server.exe
make build-server-mac        # macOS arm64     → dist/server-mac/  (Docker, no Apple SDK!)
make build-server-all        # all three server builds
make build-server-container  # Linux container image with Tesseract → recall-server:local
```

### Other build commands

```sh
make clean              # remove dist/, build/bin/, frontend/dist, frontend/node_modules
DOCKER=podman make ...  # use Podman instead of Docker
go build ./...          # compile-check Wails variant
go build -tags serveronly ./...  # compile-check server variant
```

## Maintenance

```sh
make fmt            # format all Go source files (goimports-reviser for import groups, then gofumpt)
make lint           # all linters: golangci-lint (both build tags), ESLint, Stylelint, HTMLHint, Hadolint, yamllint, Spectral
make lint-yaml      # yamllint only
make lint-openapi   # Spectral only (api/openapi.yaml)
make update-deps    # update Go modules (go get -u + mod tidy) and npm packages
make trivy          # vulnerability scan — fails on HIGH/CRITICAL findings
make cloc           # count lines of source code (excludes deps, build artifacts, generated files)
make icon           # resync build/appicon.png from assets/icon.png (macOS only; run after updating the icon)
```

`trivy` requires a one-time install: `brew install trivy` or `brew bundle`.
The scan covers Go module dependencies, npm packages, and `Dockerfile.build`.

The repo includes an `.envrc` for [direnv](https://direnv.net/) with all available environment variable overrides documented and commented out. Run `direnv allow` once after cloning, then edit `.envrc` to activate any overrides you need.

## API specification

The HTTP REST + SSE surface exposed by the server binary (and the Wails app's `--server` mode) is hand-documented in [`api/openapi.yaml`](api/openapi.yaml) — OpenAPI 3.1.0.

Treat the spec as the published contract:

- When you **add or remove a route** in `pkg/cmd/server.go`, mirror the change in the spec.
- When you **change a response shape** in `pkg/app/app.go` or `pkg/parser/parser.go`, update the relevant `components.schemas.*` entry.

```sh
make swagger        # serve the spec via Swagger UI in a container (default :8080)
make lint-openapi   # lint the spec with Spectral (spectral:oas + .spectral.yaml)
```

`make lint-openapi` runs Spectral with `--fail-severity=warn`. The `spectral:oas` ruleset emits most useful issues (missing descriptions, inconsistent naming, undocumented responses) as warnings rather than errors, so promoting warnings to CI-blocking is deliberate. Override individual rule severities in `.spectral.yaml` if a rule turns out to be too strict.

`make swagger` honours the `DOCKER` env var (`DOCKER=podman make swagger` works). Override the port with `SWAGGER_PORT=9090 make swagger`.
