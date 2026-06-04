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
  - [Debian / Ubuntu](#debian--ubuntu)
  - [Windows (via WSL2)](#windows-via-wsl2)
- [Building](#building)
  - [Wails desktop app](#wails-desktop-app)
  - [Server-only binary](#server-only-binary)
  - [Other build commands](#other-build-commands)
- [Maintenance](#maintenance)
  - [npm supply-chain cooldown](#npm-supply-chain-cooldown)
  - [Git hooks (lefthook)](#git-hooks-lefthook)
  - [Preparing frontend/dist in CI jobs](#preparing-frontenddist-in-ci-jobs)
  - [Pinning GitHub Actions](#pinning-github-actions)
  - [Tagging and releasing](#tagging-and-releasing)
- [Releases](RELEASES.md) — separate doc; covers cutting stable releases and prereleases, `make release-beta` / `make release-fire` shortcuts, and recovery procedures.
- [Bug-report bundles](#bug-report-bundles)
  - [What's in a bundle](#whats-in-a-bundle)
  - [Validating a bundle (`recall-bug-finder`)](#validating-a-bundle-recall-bug-finder)
  - [Importing a bundle into the running app](#importing-a-bundle-into-the-running-app)
- [API specification](#api-specification)

## Development setup

```sh
make help       # list all available targets
```

Two workflows exist depending on your platform:

| Workflow | Platforms | Entry point |
|---|---|---|
| `make dev` — Wails hot-reload | macOS, Debian/Ubuntu | Native WebKit/WebKitGTK window; Vite HMR on `:5173`, Wails IPC on `:34115`, Go rebuilt on save |
| Server mode — headless HTTP | any (macOS, Linux, container, etc.) | `go run -tags serveronly . --server`; open `http://127.0.0.1:7000` in any browser |

Supported dev platforms are **macOS**, **Debian/Ubuntu** (apt-based), and **Windows via WSL2 Ubuntu** — see [Windows (via WSL2)](#windows-via-wsl2) below. Other Linux distros work via server mode but `make dev` won't have its package list automated.

### Quick start (macOS + Debian/Ubuntu)

If you've installed [Go 1.26+](https://go.dev/dl/) and [Node 22+](https://nodejs.org/) yourself (use `asdf`/`gvm`/`nvm`, or the official tarball — Debian's `apt golang` is usually too old), one command takes care of the rest:

```sh
make init        # or:  ./initialize.sh
```

The script is idempotent and detects the platform: on macOS it runs `brew bundle` and the `go install` lines that aren't covered by brew; on Debian it apt-installs the equivalents, downloads pinned `hadolint`/`lefthook`/`trivy` releases, then `go install`s the rest. Both paths finish with `cd frontend && npm ci` and `lefthook install` to wire the git hooks.

Macs need `xcode-select --install` first (interactive accept; the script can't do this for you).

For non-Debian Linux (RHEL/Fedora/Arch/etc.) or if you'd rather run the steps manually, the detailed per-platform sections below document what `initialize.sh` does step-by-step. Windows contributors run inside [WSL2 Ubuntu](#windows-via-wsl2) and follow the Debian path.

If you don't want to install the toolchain locally, the next section sets you up in a container instead.

### Dev Container (any host, zero install)

The repo ships a [Dev Container](https://containers.dev/) at `.devcontainer/devcontainer.json` that mirrors the Brewfile tooling on a Debian base. Open the project in VS Code (Command Palette → **Dev Containers: Reopen in Container**) or [GitHub Codespaces](https://github.com/features/codespaces) and the `.devcontainer/postCreate.sh` script installs everything for you.

**Host prerequisites by OS** (install on the host where VS Code runs — Codespaces users can skip this entirely):

- **macOS** — [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/) (or [Colima](https://github.com/abiosoft/colima)) + [VS Code](https://code.visualstudio.com/) + the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).
- **Debian / Ubuntu** — `sudo apt install docker.io` then `sudo usermod -aG docker $USER` and re-login (or follow [Docker Engine](https://docs.docker.com/engine/install/)) + VS Code + the Dev Containers extension.
- **Windows** — [Docker Desktop](https://docs.docker.com/desktop/install/windows-install/) with **Use the WSL 2 based engine** ticked in *Settings → General* + VS Code + the Dev Containers extension. Works whether you open the repo from `C:\…` (Dev Containers handles the WSL2 socket bridge) or from a path inside WSL2 via the [WSL extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl) first.

Once the prerequisites are in place, the container installs:

- Go 1.26 + Node 26 (via Dev Container Features)
- Docker (Docker-in-Docker, for `make build-*` and `make swagger`)
- `tesseract`, `sqlite3`, `jq`, `yamllint`, `cloc`, `direnv`
- `gofumpt`, `goimports-reviser`, `govulncheck`, `golangci-lint`, `wails`
- `hadolint`, `lefthook`, `trivy`
- `cd frontend && npm ci` for the Vue/Vite toolchain
- `lefthook install` to wire the pre-commit hooks

The forwarded ports (5173, 7000, 8080, 9090, 9091, 34115, 3000) cover Vite, the Recall server, Swagger UI, Prometheus, the metrics endpoint, Wails IPC, and Grafana — all surface in the VS Code "Ports" tab.

**Caveats:**

- **The Wails desktop UI does not render inside the container** (no GUI surface). Use **server mode** there: `go run -tags serveronly . --server`, then open the forwarded port `7000` in your host browser. For the native window, fall through to the [macOS](#macos) or [Debian / Ubuntu](#debian--ubuntu) host instructions below.
- `make icon` is macOS-only (uses `sips`). The Linux container will skip it.

### macOS

> **TL;DR:** `./initialize.sh` (or `make init`) runs every step in this section automatically after you've installed Xcode CLT, Homebrew, Go 1.26+, and Node 22+. Read on if you'd rather run them manually or want to understand what the script does.
>
> **Container alternative:** the [Dev Container](#dev-container-any-host-zero-install) above runs the full Debian toolchain inside Docker — use it if you don't want to install Go/Node/Tesseract on the Mac itself. Wails GUI won't render inside the container; use server mode there. Native dev below is the only path to the desktop window.

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

`frontend/wailsjs/` is gitignored — `wails build` / `wails dev` regenerates it from Go sources on every invocation. Adding a new exported `App` method? Just add it; the next `make dev` (or any desktop build) picks it up. Frontend code consumes the OpenAPI-generated `api.gen.d.ts` instead of reaching into `wailsjs/`, so devs who only run server mode (devcontainer, CI, remote box) stay in sync without ever booting the GUI.

**Day-to-day:**

```sh
make dev        # hot-reload Wails desktop app
make lint       # all linters before pushing
make fmt        # format Go source
wails doctor    # verify toolchain at any time
```

### Debian / Ubuntu

`make dev` runs natively here — the apt path installs WebKitGTK + GTK 3 + appindicator dev libraries and the same Wails CLI macOS gets. Vite HMR + live Go rebuild work the same as on macOS; only the native window chrome differs (GTK vs Cocoa).

> **TL;DR:** `./initialize.sh` (or `make init`) runs every step in this section automatically once Go 1.26+ and Node 22+ are on PATH. Read on if you're on a non-apt distro (the script bails fast on those) or want to understand what it installs.
>
> **Container alternative:** the [Dev Container](#dev-container-any-host-zero-install) above gives you the same Debian environment without touching the host — handy on a non-apt distro (Fedora, Arch, NixOS, …), or to keep a workstation toolchain-free. Wails GUI won't render inside the container; use server mode for headless work.

**One-time prerequisites** (Debian/Ubuntu — adapt for other distros):

```sh
# Go 1.26+ (distro packages are often older; official tarball is safest)
wget https://go.dev/dl/go1.26.3.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.26.3.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin:$(go env GOPATH)/bin' >> ~/.profile
source ~/.profile

# Node 26+
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
sudo apt install -y nodejs

# Wails native build deps (WebKitGTK 4.1, GTK 3, appindicator)
sudo apt install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  pkg-config build-essential

# pkg-config shims: Wails v2.12.0's webview CGo references webkit2gtk-4.0
# but Debian bookworm+/Ubuntu 24.04+ only ship 4.1. The shims point the
# 4.0 names at the installed 4.1 libs. Belt-and-suspenders with
# `wails dev -tags webkit2_4_1`, which the Makefile passes automatically.
sudo tee /usr/lib/x86_64-linux-gnu/pkgconfig/webkit2gtk-4.0.pc <<'EOF'
Name: webkit2gtk-4.0
Description: compat shim
Version: 4.1
Requires: webkit2gtk-4.1
Cflags:
Libs:
EOF
sudo tee /usr/lib/x86_64-linux-gnu/pkgconfig/javascriptcoregtk-4.0.pc <<'EOF'
Name: javascriptcoregtk-4.0
Description: compat shim
Version: 4.1
Requires: javascriptcoregtk-4.1
Cflags:
Libs:
EOF

# System tools
sudo apt install -y tesseract-ocr jq sqlite3 docker.io  # or podman

# Go-based tools (Wails CLI included)
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
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
make dev                            # generates Wails bindings + opens GTK window
```

**Day-to-day:**

```sh
make dev                         # hot-reload Wails desktop app
make lint                        # all linters before pushing
make fmt                         # format Go source
wails doctor                     # verify toolchain at any time
```

For headless work (CI, container shell, remote box without a display) use server mode:

```sh
go run -tags serveronly . --server   # browse http://127.0.0.1:7000
```

Container builds work identically to macOS — `make build-linux` / `make build-windows` / `make build-server-*` all delegate to `Dockerfile.build` and need Docker (or Podman via `DOCKER=podman make ...`) running.

### Windows (via WSL2)

Windows is supported as a *target* (release builds ship a NSIS installer and a server `.exe`) but not as a native dev OS — the toolchain assumes a POSIX shell (`bash` `scripts/*.sh`, `shellcheck`/`shfmt`, GNU `find`/`xargs`, `lefthook` hooks that shell out) and PowerShell/CMD won't carry it. The maintained dev flow is **WSL2 Ubuntu**, which drops you into the same Debian/Ubuntu environment covered above.

> **Container alternative:** the [Dev Container](#dev-container-any-host-zero-install) above also works on Windows — VS Code talks to Docker Desktop's WSL2 backend and skips most of this section. Tradeoff: no GUI for `make dev` (use server mode). The WSL2 native flow below is recommended if you want the Wails window via WSLg.

**1. Install WSL2 with Ubuntu.**

```powershell
# In PowerShell — one-time
wsl --install   # installs Ubuntu 22.04+ by default; reboot if prompted
```

The default distro matches the apt branch in [`initialize.sh`](initialize.sh), so [`make init`](#debian--ubuntu) bootstraps unchanged.

**2. Run `make` from the WSL2 bash prompt, not PowerShell or Git Bash.** The Makefile, lefthook hooks, and every `scripts/*.sh` assume bash with POSIX `find`/`xargs`/`grep` semantics. Open the *Ubuntu* terminal app (or `wsl` from any Windows shell), `cd` into your clone, and run `make` commands there.

**3. Wire up Docker Desktop's WSL2 backend.** `make build-linux` / `make build-windows` / `make build-server-*` all delegate to `Dockerfile.build`. Install [Docker Desktop](https://docs.docker.com/desktop/install/windows-install/) on the Windows host, then in *Settings → General* tick **Use the WSL 2 based engine**, and in *Settings → Resources → WSL Integration* toggle on your Ubuntu distro. Verify from the WSL2 shell:

```sh
docker info        # should print server details, not "Cannot connect…"
```

**4. `make dev` and `make test-e2e`.**

- `make dev` works on Windows 11 (and Windows 10 22H2+) via [WSLg](https://github.com/microsoft/wslg), which forwards the GTK window natively — no X server setup needed.
- **Edit in VS Code on the Windows host, run `make dev` in the WSL terminal — same directory both sides.** Install the [WSL extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl) on Windows, then from your cloned directory inside WSL2 run `code .`. VS Code reopens against the WSL filesystem, the integrated terminal lands inside WSL automatically, and `make dev` from that terminal launches Wails with WSLg forwarding the GTK window to the Windows desktop. **Clone into WSL's native FS (e.g. `~/recall`), not `/mnt/c/…`** — file-watcher latency on the Windows-mount path is bad enough to make Vite HMR feel broken.
- Older Windows 10 has no WSLg. Use server mode instead: `go run -tags serveronly . --server` and open `http://127.0.0.1:7000` in a Windows browser.
- `make test-e2e` runs Playwright headless against a built `serveronly` binary on `127.0.0.1:7099` (per [`e2e.yml`](.github/workflows/e2e.yml)). No X11 or WSLg needed; works on every Windows version that supports WSL2.

**5. Install Tesseract inside WSL2, not on the Windows side.**

```sh
sudo apt install tesseract-ocr
```

That puts the binary at `/usr/bin/tesseract`, which Recall auto-detects on first launch. The Windows-side UB-Mannheim MSI from [`docs/install-windows.md`](docs/install-windows.md) is for end-users running the shipped `.exe`; the WSL2 dev binary is a Linux binary and won't see it.

**6. Point Recall at your Overwatch screenshots — they live on the Windows side.** Overwatch on Windows writes to `C:\Users\<you>\Documents\Overwatch\ScreenShots\Overwatch\`. From WSL2 that path is mounted at `/mnt/c/Users/<you>/Documents/Overwatch/ScreenShots/Overwatch/` — use the `/mnt/c/...` form in Recall's *Settings → Screenshots*. The `/mnt/c` reads are slower than the WSL2 native filesystem but fine for the watcher's per-image cadence.

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
make cover-go       # Go coverage; fails when total < GO_COVERAGE_MIN (default 46%)
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

### npm supply-chain cooldown

`frontend/.npmrc` sets `min-release-age=7` so every `npm install` from inside `frontend/` rejects npm package versions younger than seven days. This catches the typical hijacked-publish → npm-unpublish window — Shai-Hulud, the 2025 worm wave, and the recent compromises of `@ctrl/tinycolor` et al. were all detected and pulled inside 72 h. Dependabot honours `.npmrc` when it builds the updated tree, so a malicious publish that lands during its weekly window won't generate a PR until the cooldown elapses (by which point npm has usually pulled it).

Requires npm ≥ 11.0; CI (`actions/setup-node` with Node 26) and `Dockerfile.build` (`node:26-slim`) both ship npm 11 already. `npm ci` is unaffected — it installs exact versions from the lockfile without re-resolving — so checkouts and CI builds remain reproducible.

**Emergency CVE override** (when a same-day patch needs to land before the cooldown elapses):

```sh
npm --prefix frontend install <pkg> --min-release-age=0
```

Bypasses the cooldown for that one invocation only. Commit the lockfile change with a `fix:` or `chore(security):` prefix and call out the override in the commit body so future readers understand why a fresh version landed inside the window.

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
| `coverage` | *(always)*                   | `make cover` — runs Go + Vitest coverage, fails when below the thresholds (Go `GO_COVERAGE_MIN` 46%, frontend `vitest.config.ts` 70/70/60/55). Skip with `LEFTHOOK_EXCLUDE=coverage git push` — CI re-runs the same checks so an override on push still fails the PR. **Ratchet policy:** every release is a chance to bump `GO_COVERAGE_MIN` upward by `floor(current) - 2` to lock in new coverage. |

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

### Preparing frontend/dist in CI jobs

`assets.go` has `//go:embed all:frontend/dist`, so any CI job that loads the root Go package — `go build`, `go list`, `gosec`, `deadcode`, schemathesis's server build, etc. — needs `frontend/dist/` to exist. The `.github/actions/prepare-frontend-dist` composite action handles both shapes:

```yaml
- name: Prepare frontend/dist (real Vite build)
  uses: ./.github/actions/prepare-frontend-dist
  with:
    real-assets: "true"      # ~30s; needed for e2e, coverage, bundle-size
```

```yaml
- name: Prepare frontend/dist (stub for //go:embed)
  uses: ./.github/actions/prepare-frontend-dist
  with:
    real-assets: "false"     # cheap stub; for gosec, deadcode, CodeQL Go
```

Don't open-code `mkdir -p frontend/dist && touch frontend/dist/index.html` or `cd frontend && npm ci && npm run build` in new workflow steps — call the composite. It SHA-pins its own `setup-node` dependency and is covered by `scripts/check-action-pins.sh`.

### Pinning GitHub Actions

Every third-party action referenced from `.github/workflows/` is pinned by **40-character commit SHA** with a trailing `# vX.Y.Z` version comment. Tag-pinned refs (e.g. `actions/checkout@v4`) are rejected by `scripts/check-action-pins.sh`, which runs in the `lint` job + the lefthook `actionlint` pre-push hook + `make lint-actions`.

Format:

```yaml
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4
```

The SHA is the source of truth; the comment is for humans. **Two spaces before the `#`** to keep yamllint happy.

**Why:** a tag can be silently re-pointed to a malicious commit by a compromised maintainer account or stolen token. Pinning by SHA freezes the exact code that runs. This has happened in the wild — see `tj-actions/changed-files` (March 2025).

**Adding a new action:** resolve the tag to a SHA with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`, then paste into `uses:` with the `# vX.Y.Z` comment. The CI guard fails the build if you forget.

**Bumping an action:** Dependabot (configured in `.github/dependabot.yml`) understands the SHA + version-comment format and updates both fields on its weekly run. Most bumps will arrive as a Dependabot PR.

**First-party composite actions** (`./.github/actions/foo`) are exempt — they live in the same repo as the workflow.

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

## Bug-report bundles

Users send in a `.zip` from the **Export bundle…** affordance on the Matches view's bulk-action bar. The bundle packages the matches the user ticked plus (optionally) every hidden / unknown match into one archive suitable for triaging a regression you can't reproduce. Two maintainer workflows ship alongside it: a validator CLI and an in-app import.

### What's in a bundle

Three pieces at the ZIP root (schema in `pkg/app/export_bundle.go`):

- `manifest.json` — `recall-bundle/v1` envelope: provenance (`exported_at`, `recall_version`), `match_count`, `screenshot_count`, the include-toggle state, and the screenshot ↔ `match_key` map for sanity-checking after extract.
- `data.json` — the same `recall-export/v1` shape `GET /api/v1/exports` already produces, restricted to the included matches. **Deliberately omits `screenshots_dirs`** — that map carries the user's absolute filesystem path and would leak PII on every bug report. Restored rows land with `ScreenshotsDirID = 0` (use configured dir).
- `screenshots/<filename>` — the source-file bytes for every included match. Missing-on-disk files are silently skipped at export time (the row still ships in `data.json` so a re-parse can fill the gap).

### Validating a bundle (`recall-bug-finder`)

First move when a bundle lands in your inbox. The CLI cross-validates the three pieces above and reports any drift between them.

```sh
make bug-finder
build/bin/recall-bug-finder path/to/user-bundle.zip
```

A consistent bundle prints `✓ … internally consistent` and exits 0. A bundle with discrepancies prints one `[kind] message` line per issue and exits 1; bad CLI input (missing arg, unreadable file, malformed ZIP) exits 2.

The issue kinds are stable string constants in `pkg/app/bundle_validate.go` so a scripted wrapper can grep on them without re-parsing the message. The 11 kinds today: `missing_manifest`, `missing_data`, `wrong_manifest_schema`, `wrong_data_schema`, `match_count_mismatch`, `screenshot_count_mismatch`, `manifest_missing_screenshot_file`, `orphan_screenshot_file`, `manifest_key_not_in_data`, `data_file_not_in_manifest`, `screenshots_dirs_leak`.

The tool is maintainer-only — it's not in `make build-all`, not published to GitHub releases, and not surfaced from the UI. Built locally on demand. The validator logic lives in `pkg/app/bundle_validate.go`; the CLI in `cmd/bug-finder/main.go` is a thin shell over it.

### Importing a bundle into the running app

Once the validator is happy, load the bundle into a running Recall instance to inspect the user's matches in the real UI:

1. Boot the app — `make dev` (Wails) or the server binary + a browser.
2. **Settings → Backup & Restore → Import Backup → Choose File…** and pick the bundle `.zip`. `ImportData` (`pkg/app/export.go`) sniffs the magic bytes — bundles look like a ZIP, the ZIP branch resolves `data.json` against the `recall-export/v1` schema, and every row lands in your local SQLite under the active profile.

**Caveat — the `screenshots/` folder is not auto-extracted.** The import flow only reads `data.json`; the bundled screenshot bytes stay in the ZIP. To make the lightbox + per-row previews work for the imported matches, manually copy the bundle's `screenshots/*` files into your configured screenshots folder (Settings → Folders → Screenshots folder, or `<profile>/settings.json::screenshots_dir`). That works because every row imported from a bundle carries `ScreenshotsDirID = 0`, and `pkg/app/screenshot_handler.go` falls back to `a.settings.ScreenshotsDir` whenever the dir-id is 0.

Use a throwaway profile (masthead chip → **+ New profile**) for triage so the user's matches don't pollute your real history; switch back to your normal profile when done.

## API specification

The HTTP REST + SSE surface exposed by the server binary (and the Wails app's `--server` mode) is hand-documented in [`api/openapi.yaml`](api/openapi.yaml) — OpenAPI 3.1.0.

Treat the spec as the published contract:

- When you **add or remove a route** in `pkg/cmd/server.go`, mirror the change in the spec.
- When you **change a response shape** in `pkg/app/app.go` or `pkg/parser/parser.go`, update the relevant `components.schemas.*` entry.
- When you **add a field to an existing Go struct** (not a new method), the update is a 2-step follow-up: (1) update the struct + OpenAPI schema, (2) `make gen-types` to refresh `api.gen.d.ts`. `frontend/wailsjs/` is a gitignored build artifact regenerated by `wails build`; `api.ts` consumes `api.gen.d.ts` for both Wails and server transports, so there's no second file to keep in sync.

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
