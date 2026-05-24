# Contributing

This guide covers setting up a local development environment, building the
project for all target platforms, and maintaining code quality. For an
overview of the architecture and internal conventions, see
[`CLAUDE.md`](CLAUDE.md).

> Before opening an issue or PR, please read the
> [Code of Conduct](CODE_OF_CONDUCT.md). TL;DR: be kind, and respect that
> the project is maintained in spare time and given away free — no demands,
> no SLAs on replies, bug fixes, or feature requests.

## Table of Contents

- [Development setup](#development-setup)
  - [Dev Container (any host, zero install)](#dev-container-any-host-zero-install)
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
  - [Git hooks (lefthook)](#git-hooks-lefthook)
  - [Tagging and releasing](#tagging-and-releasing)
- [Releases](RELEASES.md) — separate doc; covers cutting stable releases and prereleases, `make release-beta` / `make release-fire` shortcuts, and recovery procedures.
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

### Quick start (macOS + Debian/Ubuntu)

If you've installed [Go 1.26+](https://go.dev/dl/) and [Node 22+](https://nodejs.org/) yourself (use `asdf`/`gvm`/`nvm`, or the official tarball — Debian's `apt golang` is usually too old), one command takes care of the rest:

```sh
make init        # or:  ./initialize.sh
```

The script is idempotent and detects the platform: on macOS it runs `brew bundle` and the `go install` lines that aren't covered by brew; on Debian it apt-installs the equivalents, downloads pinned `hadolint`/`lefthook`/`trivy` releases, then `go install`s the rest. Both paths finish with `cd frontend && npm ci` and `lefthook install` to wire the git hooks.

Macs need `xcode-select --install` first (interactive accept; the script can't do this for you).

For other platforms (Windows, non-Debian Linux), or if you'd rather run the steps manually, the detailed per-platform sections below document what `initialize.sh` does step-by-step.

If you don't want to install the toolchain locally, the next section sets you up in a container instead.

### Dev Container (any host, zero install)

The repo ships a [Dev Container](https://containers.dev/) at `.devcontainer/devcontainer.json` that mirrors the Brewfile tooling on a Debian base. Open the project in VS Code (Command Palette → **Dev Containers: Reopen in Container**) or [GitHub Codespaces](https://github.com/features/codespaces) and the `.devcontainer/postCreate.sh` script installs everything for you:

- Go 1.26 + Node 26 (via Dev Container Features)
- Docker (Docker-in-Docker, for `make build-*` and `make swagger`)
- `tesseract`, `sqlite3`, `jq`, `yamllint`, `cloc`, `direnv`
- `gofumpt`, `goimports-reviser`, `govulncheck`, `golangci-lint`, `wails`
- `hadolint`, `lefthook`, `trivy`
- `cd frontend && npm ci` for the Vue/Vite toolchain
- `lefthook install` to wire the pre-commit hooks

The forwarded ports (5173, 7000, 8080, 9090, 9091, 34115, 3000) cover Vite, the Recall server, Swagger UI, Prometheus, the metrics endpoint, Wails IPC, and Grafana — all surface in the VS Code "Ports" tab.

**Caveats:**

- **The Wails desktop UI does not render inside the container** (no GUI surface). Use **server mode** there: `go run -tags serveronly . --server`, then open the forwarded port `7000` in your host browser. For the native window, fall through to the macOS / Linux / Windows host instructions below.
- `make icon` is macOS-only (uses `sips`). The Linux container will skip it.

### macOS

> **TL;DR:** `./initialize.sh` (or `make init`) runs every step in this section automatically after you've installed Xcode CLT, Homebrew, Go 1.26+, and Node 22+. Read on if you'd rather run them manually or want to understand what the script does.

**One-time prerequisites:**

```sh
xcode-select --install          # Xcode Command Line Tools (required for Wails CGo builds)
brew bundle                     # Go, Node, Tesseract, Podman, golangci-lint, yamllint, direnv, etc.
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
go install mvdan.cc/gofumpt@latest
go install github.com/incu6us/goimports-reviser/v3@latest
go install golang.org/x/tools/cmd/deadcode@latest
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
make dev                            # generates fresh Wails bindings on first run
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

> **TL;DR (Debian/Ubuntu only):** `./initialize.sh` (or `make init`) runs every step in this section automatically after you've installed Go 1.26+ and Node 22+. Read on if you're on a non-apt distro, or if you'd rather run the steps manually.

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

Recall ships two binary flavors:

| Flavor | What it is | CGo? |
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
make test           # Go unit tests (-race) + Vitest frontend tests (parser golden-file tests skip unless RECALL_FIXTURE_DIR is set)
make cover          # Go + frontend coverage reports (umbrella; both gate on thresholds)
make cover-go       # Go coverage; fails when total < GO_COVERAGE_MIN (default 40%)
make cover-frontend # JS/TS coverage; fails when below the thresholds in vitest.config.ts
make typecheck      # vue-tsc --noEmit — covers .ts files and <script lang="ts"> Vue SFCs; allowJs: false enforces no JS
make gen-types      # regenerate frontend/src/api.gen.d.ts from api/openapi.yaml (run after every spec edit)
make update-deps    # update Go modules (go get -u + mod tidy) and npm packages
make trivy          # vulnerability scan — fails on HIGH/CRITICAL findings
make dead-code      # whole-program dead Go code (serveronly) + unused TS exports (knip)
make dead-code-go   # Go only: deadcode -tags serveronly ./...
make dead-code-ts   # TypeScript only: knip (unused exports, files, deps)
make cloc           # count lines of source code (excludes deps, build artifacts, generated files)
make icon           # resync build/appicon.png from assets/icon.png (macOS only; run after updating the icon)
```

**Running `npx vitest` / `npm run *` directly?** Do it from `frontend/`, not the repo root — Vite resolves `vitest.config.ts` from cwd, so running from elsewhere fails with a misleading "Install @vitejs/plugin-vue to handle .vue files" even though the plugin IS installed. Use `cd frontend && …` or `npm --prefix frontend run …`. The `make` targets above handle cwd automatically.

`trivy` requires a one-time install: `brew install trivy` or `brew bundle`.
The scan covers Go module dependencies, npm packages, and `Dockerfile.build`.

The repo includes an `.envrc` for [direnv](https://direnv.net/) with all available environment variable overrides documented and commented out. Run `direnv allow` once after cloning, then edit `.envrc` to activate any overrides you need.

### Git hooks (lefthook)

[Lefthook](https://github.com/evilmartians/lefthook) is configured in `lefthook.yml` with three hook stages. Hooks run in parallel and auto-fix where possible.

**One-time install:**

```sh
brew bundle             # installs lefthook itself
lefthook install        # wires the hooks into .git/hooks/{pre-commit,pre-push,commit-msg}
```

**`pre-commit`** — runs on every `git commit` against **staged files only**. Fast feedback loop; CI re-runs the full lint pass against the whole tree regardless.

| Hook | Glob | Tool(s) it invokes |
|---|---|---|
| `gofumpt`           | `*.go`                          | `gofumpt`            (Go formatter — `go install mvdan.cc/gofumpt@latest`) |
| `goimports-reviser` | `*.go`                          | `goimports-reviser`  (`go install github.com/incu6us/goimports-reviser/v3@latest`) |
| `golangci-lint`     | `*.go`                          | `golangci-lint`      (`brew install golangci-lint` or `go install`) |
| `eslint`            | `frontend/src/**/*.{ts,vue}`    | `eslint` + `typescript-eslint` (auto-installed by `cd frontend && npm ci`) |
| `stylelint`         | `frontend/src/**/*.{css,vue}`   | `stylelint`          (auto-installed by `cd frontend && npm ci`) |
| `spectral`          | `api/openapi.yaml`              | `npx @stoplight/spectral-cli` (auto-pulled on demand by `npx`) |
| `gen-types`         | `api/openapi.yaml`              | `make gen-types` — regenerates `frontend/src/api.gen.d.ts` and auto-stages it so the generated file is never out of sync with the spec. |
| `yamllint`          | `*.{yml,yaml}` (excl. openapi)  | `yamllint`           (`brew install yamllint` or `pip install yamllint`) |
| `hadolint`          | `Dockerfile*`                   | `hadolint`           (`brew install hadolint`) |

**`pre-push`** — runs on `git push`. These hooks all do whole-project scans (dead code, unused exports, coverage roll-up) that can't be meaningfully scoped to staged files, so this stage keeps WIP commits fast while catching cross-cutting regressions before they reach origin.

| Hook | Glob | Tool(s) it invokes |
|---|---|---|
| `deadcode` | `*.go`                       | `deadcode` (`go install golang.org/x/tools/cmd/deadcode@latest`) — whole-program call-graph analysis for the `serveronly` build tag |
| `knip`     | `frontend/src/**/*.{ts,vue}` | `knip` (auto-installed by `cd frontend && npm ci`) — unused TypeScript exports and stale devDependencies |
| `coverage` | *(always)*                   | `make cover` — runs Go + Vitest coverage, fails when below the thresholds (Go `GO_COVERAGE_MIN` 40%, frontend `vitest.config.ts` 70/70/60/55). Skip with `LEFTHOOK_EXCLUDE=coverage git push` — CI re-runs the same checks so an override on push still fails the PR. |

If a tool isn't installed, the corresponding hook fails — install it (or skip the hook for one push/commit, see below).

**`commit-msg`** — runs on every `git commit`. Validates the subject line format (no file glob — always runs):

Subject must match `<type>(<scope>)?(!)?: <description>`. Allowed types:

```text
feat fix chore docs refactor test perf build ci revert style
```

Example valid messages (single scope only — `feat(parser,app):` is rejected by the commit-msg hook; split the change into two commits, or pick the primary scope):

```text
feat(parser): add Suravasa map alias
fix: rename brand-grey CSS var to brand-gray
feat!: bump min Go to 1.27
chore(deps): bump trivy-action to v0.36.0
```

The format isn't cosmetic — `release-please` (next section) reads it to compute version bumps and regenerate `CHANGELOG.md`.

**Body style — follow the [Linux kernel commit guidelines](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#describe-your-changes).** The Conventional Commits prefix lives on top of those rules; they govern everything after the subject. Quick checklist:

- **Subject** ≤ 72 chars (≤ 50 preferred), imperative mood ("add" / "fix" / "rename", not "added" / "adds"), no trailing period.
- **Blank line** between subject and body.
- **Wrap body at 72 chars.** No exceptions for prose; URLs and code snippets may exceed but should sit on their own lines.
- **Explain *why*, not *what*.** The diff already shows what; the body's job is the motivation, the alternatives considered, and the user-visible consequence.
- **Imperative mood in the body too**, where it reads naturally.
- **Reference issues, regressions, and prior commits with kernel-style trailers** (one per line, at the bottom of the body, no trailing blank line before the sign-off):
  - `Fixes: <12-char-sha> ("<subject of the buggy commit>")` when fixing a regression
  - `Reported-by: Name <email>` when crediting a bug reporter
  - `Reviewed-by:`, `Tested-by:`, `Suggested-by:`, `Acked-by:` as appropriate
  - `Co-Authored-By: Name <email>` for shared work
  - `Closes #N` / `Refs #N` for GitHub issue references
- **`Signed-off-by:` (DCO)** is encouraged via `git commit -s`. Confirms you have the right to submit the change under the project license.

Example combining the layers:

```text
fix(parser): handle italic-font OCR letter→digit confusion on PERSONAL

The OW italic stat font renders "0" close enough to "O" that Tesseract
returns "5O" instead of "50" for the WEAPON ACCURACY card on Lucio.
parsePersonalStatCell already coerces O/Q/I/l/L → digits but ran the
substitution after the value-extraction regex, so the misread digit
was lost. Move the digitize() call upstream of the regex.

Fixes: a511b6b1d1df ("fix hero percentage when only 1 hero is played")
Reported-by: Jacob Delgado <jacob.delgado@gmail.com>
Signed-off-by: Jacob Delgado <jacob.delgado@gmail.com>
```

Atomicity matters: each commit should describe **one** logical change. If the subject needs an "and" to be accurate, split the commit. A bug fix doesn't need surrounding refactors; a feature doesn't need stylistic cleanups bundled in.

**Bypasses** (use sparingly):

```sh
LEFTHOOK=0 git commit -m "wip"                              # skip all pre-commit hooks
LEFTHOOK_EXCLUDE=conventional git commit -m "fixup"         # skip just commit-msg
LEFTHOOK_EXCLUDE='conventional,golangci-lint' git commit …  # skip multiple
LEFTHOOK_EXCLUDE='deadcode,knip' git push                   # skip pre-push dead-code scan
LEFTHOOK_EXCLUDE=coverage git push                          # skip pre-push coverage gate
```

Hooks bypassed locally will still fail in CI on push — bypass is for in-flight WIP commits, not a way around the rules.

### Tagging and releasing

Moved to its own doc — see [RELEASES.md](RELEASES.md). It covers:

- the release-please → `v*` tag → `release.yml` flow (with a `mermaid` diagram and a stable-vs-prerelease comparison table),
- the `make release-beta VERSION=…` shortcut for cutting prereleases,
- `make release-fire TAG=…` for the rare case where `release.yml` doesn't auto-fire,
- one-time repo setup (`RELEASE_PLEASE_TOKEN` PAT, workflow permissions),
- recovery procedures (emergency manual tag, skipping/pausing release-please).

The 30-second version for prereleases:

```sh
make release-beta VERSION=0.0.13-beta.0
git push origin main
# … merge the Release PR release-please opens …
# If RELEASE_PLEASE_TOKEN is configured, release.yml fires on its own.
# Otherwise:
make release-fire TAG=v0.0.13-beta.0
```

## API specification

The HTTP REST + SSE surface exposed by the server binary (and the Wails app's `--server` mode) is hand-documented in [`api/openapi.yaml`](api/openapi.yaml) — OpenAPI 3.1.0.

Treat the spec as the published contract:

- When you **add or remove a route** in `pkg/cmd/server.go`, mirror the change in the spec.
- When you **change a response shape** in `pkg/app/app.go` or `pkg/parser/parser.go`, update the relevant `components.schemas.*` entry.
- When you **add a field to an existing Go struct** (not a new method), the update is a 3-step follow-up: (1) update the struct + OpenAPI schema, (2) `make gen-types` to refresh `api.gen.d.ts`, (3) **manually edit `wailsjs/go/models.ts`** to add the field — Wails only auto-regenerates that file on `wails dev` (macOS). Missing step 3 silently breaks Wails mode while server mode continues to work.

```sh
make swagger        # serve the spec via Swagger UI in a container (default :8080)
make lint-openapi   # lint the spec with Spectral (spectral:oas + .spectral.yaml)
```

`make lint-openapi` runs Spectral with `--fail-severity=warn`. The `spectral:oas` ruleset emits most useful issues (missing descriptions, inconsistent naming, undocumented responses) as warnings rather than errors, so promoting warnings to CI-blocking is deliberate. Override individual rule severities in `.spectral.yaml` if a rule turns out to be too strict.

`make swagger` honors the `DOCKER` env var (`DOCKER=podman make swagger` works). Override the port with `SWAGGER_PORT=9090 make swagger`.

The spec also feeds the frontend's typed API client (`frontend/src/api.ts`). After editing `api/openapi.yaml`:

```sh
make gen-types     # regenerate frontend/src/api.gen.d.ts
make typecheck     # confirm api.ts still type-checks against the new shape
```

CI runs both and additionally fails if `api.gen.d.ts` is out of sync with the spec — so commit the regenerated `.d.ts` alongside any spec change.
