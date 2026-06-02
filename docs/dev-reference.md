# Dev reference

Reference tables for Recall development. **Not auto-loaded into any Claude Code
session** — read on demand when you need a specific command, env var, or layout
detail. Behavioral rules live in `.claude/rules/*.md`; the always-on summary is
in the root `CLAUDE.md`.

## Build flavors

Two binary flavors, selected by the `serveronly` Go build tag:

| Tag | Entry point | CGo | Description |
|---|---|---|---|
| *(default)* | `main.go` + `pkg/app/app_wails.go` | Yes | Full Wails desktop app |
| `serveronly` | `main_server.go` + `pkg/app/app_server.go` | No | Headless HTTP server (addr from `RECALL_SERVER_ADDR`, default `127.0.0.1:7000`) |
| *(none — both)* | `assets.go` | No | `//go:embed all:frontend/dist` — embedded FS shared by both variants |

## Full make-target catalog

| Command | Purpose |
|---|---|
| `make init` | Fresh-clone setup via `initialize.sh`: brew/apt deps, `go install` for tools not in Brewfile (Wails CLI, gofumpt, goimports-reviser, deadcode, govulncheck), Debian `webkit2gtk-4.0` → `4.1` shims, `npm ci`, `lefthook install`, `direnv allow`. Idempotent. Needs Go 1.26+ / Node 22+ on PATH first. |
| `make dev` | Hot-reload dev server (macOS / Debian / Ubuntu). Vite `:5173`, Wails IPC `:34115`. Linux auto-passes `-tags webkit2_4_1`. |
| `make build-linux` / `build-windows` | Wails app → `dist/<os>/Recall[.exe]` via Docker (mingw-w64 for Windows). |
| `make build-mac` | macOS Wails app → `dist/mac/Recall.app` (macOS host). Release workflow wraps it in a DMG. |
| `make build-all-docker` | Linux + Windows Wails apps — no macOS SDK needed. |
| `make build-server-{linux,windows,mac}` | Server binary → `dist/server-<os>/Recall-server` via Docker. |
| `make build-server-all` / `build-server-container` | All three server builds / Linux server container image with Tesseract → `recall-server:local`. |
| `make build-all` | All three Wails platforms (macOS host required). |
| `go build ./...` / `-tags serveronly ./...` | Compile-check Wails / server variant. |
| `bash -n scripts/X.sh` | Syntax-check a shell script. |
| `brew bundle` | Tesseract, Go toolchain, Podman, etc. from `Brewfile`. **Wails CLI separate**: `go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0`. |
| `direnv allow` | Activate `.envrc`. |
| `cd frontend && npm ci` | Install frontend deps (required after clone / `make clean`). |
| `make fmt` | Go (`goimports-reviser` → `gofumpt`) + shell (`shfmt -w -i 2 -ci -bn`). Sub-targets `fmt-go`, `fmt-shell`. |
| `make lint` | golangci-lint (both tags), ESLint, Stylelint, HTMLHint, shellcheck + shfmt diff, Hadolint, yamllint, Spectral. |
| `make clean` | Remove `dist/`, `build/bin/`, `frontend/{dist,node_modules}`. |
| `make update-deps` | `go get -u ./...` + `go mod tidy` + `npm update`. |
| `make check-deps` | Compare pinned tools vs latest. |
| `make trivy` | Trivy scan (Go + npm + Dockerfile); fails on HIGH/CRITICAL. |
| `make cloc` / `cloc-detail` | LOC summary. |
| `make icon` | Resync `build/appicon.png` from `assets/icon.png` (macOS-only `sips`). |
| `make swagger` | Swagger UI v5 in a container (default `:8080`, `SWAGGER_PORT` override). |
| `make pages-build` / `pages-preview` | Build docs book + Swagger UI under `dist/pages/`. |
| `make lint-openapi` | Spectral (`spectral:oas` + `.spectral.yaml`, `--fail-severity=warn`). |
| `make test` | Go unit (`-race`; `pkg/{app,db,parser}/*_test.go`) + Vitest. CI uses `-short` to skip the golden test. |
| `make cover` / `cover-go` / `cover-frontend` | Coverage → `coverage/go/` + `frontend/coverage/`. Go fails below `GO_COVERAGE_MIN`; frontend below `vitest.config.ts` `coverage.thresholds`. |
| `make test-e2e` | Playwright. Builds frontend + `serveronly` into `/tmp/recall-e2e/recall-server`, installs Chromium, runs with `HOME=/tmp/recall-e2e` on `127.0.0.1:7099`. |
| `make test-all` | `make test` + `make test-e2e`. |
| `make gen-types` | Regenerate `frontend/src/api.gen.d.ts` from `api/openapi.yaml`. |
| `make typecheck` | `vue-tsc --noEmit`. `allowJs: false` blocks JS introduction. |
| `make update-goldens` | Regenerate parser golden sidecars (or set `RECALL_FIXTURE_UPDATE=1`). |

> **Drift note:** specific numeric gates (`GO_COVERAGE_MIN`, Vitest thresholds,
> bundle budgets) and version pins (Wails, Go, Node, tool versions) are
> intentionally NOT duplicated here — read them from `vitest.config.ts`,
> `tool-versions.env`, `go.mod`, and `Brewfile` so this doc can't go stale.

## Package layout (`pkg/`)

| Package | Contents |
|---|---|
| `pkg/app` | `App` struct + file-per-concern under `pkg/app/*.go`. Production / test files are 1:1 (`watcher.go` ↔ `watch_events_test.go`). Build-tag pair `app_wails.go` / `app_server.go`. `ls pkg/app/*.go` is the source of truth. |
| `pkg/cmd` | `RunWails` (Wails init) and `RunServer` (HTTP server + REST API). |
| `pkg/db` | SQLite `Init()` + `DB` variable. |
| `pkg/metrics` | Prometheus `Collector` + `Server`. |
| `pkg/parser` | OCR pipeline split per concern. `ls pkg/parser/*.go` is the source of truth. |

`.devcontainer/devcontainer.json` + `postCreate.sh` mirror the Brewfile on a
Debian + Docker-in-Docker base for VS Code Dev Containers / Codespaces. The Wails
GUI can't render inside the container; contributors there use
`go run -tags serveronly . --server` and access port 7000 via the forwarded host
port. Native-window dev hosts: **macOS** and **Debian/Ubuntu** (both run
`make dev`); Windows is a release target only (dev via WSL2 Ubuntu).

`Dockerfile.build` has 14 named stages. Stages 1–6 are the Wails builds (CGo +
WebView libs). Stages 7–13 are the `serveronly` builds — pure Go,
`CGO_ENABLED=0`, cross-compiled on Linux for all three OS targets incl. macOS
arm64. Stage 14 (`server-container`) is a `debian:bookworm-slim` runtime image
with Tesseract pre-installed.

## Environment variable overrides (all optional, mainly for debugging)

| Var | Default | Effect |
|---|---|---|
| `RECALL_DATA_DIR` | platform user-config dir | Install-wide base directory. Each profile gets `<base>/profiles/<name>/{settings.json,db/recall.db}`. The repo's `.envrc` sets this to `$PWD/data`. |
| `RECALL_PROFILE` | *(unset — script-only)* | Forces `scripts/db-*.sh` to operate on a specific profile. Mirrors the app's `--profile=<name>` CLI flag. Not read by the app binaries. |
| `RECALL_DEBUG_DIR` | system temp | Directory for Tesseract work files. |
| `OWMETRICS_DEBUG_DIR` | *(off)* | Dumps raw Tesseract output `.txt` files per OCR call. **⚠ prefix likely stale — see review note below.** |
| `OWMETRICS_METRICS_ADDR` | `:9091` | Override Prometheus metrics bind address. **⚠ prefix likely stale.** |
| `RECALL_SERVER_ADDR` | `127.0.0.1:7000` | Override the HTTP server bind address. Set to `0.0.0.0:7000` inside Docker. |
| `DOCKER` | `docker` | Container runtime binary for `make build-*`. Set to `podman` for Podman. |
| `RECALL_PPROF` | *(off)* | Mounts `net/http/pprof` under `/debug/pprof/` in server mode. Never expose publicly. |
| `RECALL_FIXTURE_DIR` | `../../testdata` (from `pkg/parser/`) | `.png` fixture dir for `TestParseScreenshot_GoldenFiles`. Override with an ABSOLUTE path. |

> **⚠ Review note:** the env-var surface mixes `RECALL_*` and `OWMETRICS_*`
> prefixes, which strongly suggests an incomplete rename from a previous project
> name. Confirm against `os.Getenv` call sites which `OWMETRICS_*` vars (if any)
> the binaries still read, and either rename them to `RECALL_*` or document why
> they're frozen.

## Helper scripts (`scripts/`)

| Script | What it does |
|---|---|
| `stack-up.sh` | Start podman VM if needed, slam VM clock to host time, apply gcloud-cred-helper workaround, `podman-compose up -d`. |
| `stack-down.sh` | `podman-compose down`. `--machine` also stops the VM. |
| `prometheus-clear.sh` | Tears down stack, removes the `*_prometheus_data` volume (preserves Grafana state), restarts. |
| `verify-stack.sh` | Layer-by-layer diagnostic: SQLite → /metrics → container → Prometheus scrape state → TSDB sample count. Read-only. Run first when Grafana shows no data. |
| `db-list.sh` / `db-show.sh` / `db-delete.sh` / `db-export.sh` / `clear-db.sh` / `db-stats.sh` / `db-where.sh` / `db-orphans.sh` / `db-reparse.sh` | SQLite CRUD + diagnostics. `db-show` accepts id/match_key/filename substring; `db-orphans` finds child rows whose parent vanished; `db-reparse` queues a re-parse. |
| `_lib.sh` | Shared `docker_config_aside()` helper for the gcloud cred-helper trap. |
| `check-deps.sh` | Compares pinned tool versions vs latest GitHub releases. |
| `check-action-pins.sh` | Validates every `uses:` is SHA-pinned with a `# vX.Y.Z` comment. |
| `deadcode-check.sh` | Runs `deadcode` against `serveronly`, filters via `scripts/deadcode-allow.txt`, fails on non-empty residual. |
| `render-pr-report.py` | Renders the markdown PR report from CI artifacts. |

## Quick local exploration

For a throwaway probe outside the test runner, an `x*_test.go` in `pkg/app/` that
imports `recall/pkg/app` directly and calls `app.Startup` +
`app.ParseScreenshots` works — delete the file when done so it doesn't accumulate.
