# Contributing

This guide covers setting up a local development environment, building the
project for all target platforms, and maintaining code quality. For an
overview of the architecture and internal conventions, see
[`CLAUDE.md`](CLAUDE.md).

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
  - [Pre-commit hooks (lefthook)](#pre-commit-hooks-lefthook)
  - [Tagging and releasing](#tagging-and-releasing)
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
make update-deps    # update Go modules (go get -u + mod tidy) and npm packages
make trivy          # vulnerability scan — fails on HIGH/CRITICAL findings
make cloc           # count lines of source code (excludes deps, build artifacts, generated files)
make icon           # resync build/appicon.png from assets/icon.png (macOS only; run after updating the icon)
```

`trivy` requires a one-time install: `brew install trivy` or `brew bundle`.
The scan covers Go module dependencies, npm packages, and `Dockerfile.build`.

The repo includes an `.envrc` for [direnv](https://direnv.net/) with all available environment variable overrides documented and commented out. Run `direnv allow` once after cloning, then edit `.envrc` to activate any overrides you need.

### Pre-commit hooks (lefthook)

[Lefthook](https://github.com/evilmartians/lefthook) is configured in `lefthook.yml` to run formatters and linters on the **staged files only** before each commit. Hooks run in parallel and auto-fix where possible.

**One-time install:**

```sh
brew bundle             # installs lefthook itself
lefthook install        # wires the hooks into .git/hooks/{pre-commit,commit-msg}
```

Lefthook then runs automatically on every `git commit`. CI re-runs the full lint pass against the whole tree regardless, so the hooks are a fast feedback loop, not a hard gate.

**What each hook requires to be on PATH** (already covered by `make fmt` / `make lint` tooling — full install instructions are under the per-platform sections above):

| Hook | Glob | Tool(s) it invokes |
|---|---|---|
| `gofumpt`           | `*.go`                          | `gofumpt`            (Go formatter — `go install mvdan.cc/gofumpt@latest`) |
| `goimports-reviser` | `*.go`                          | `goimports-reviser`  (`go install github.com/incu6us/goimports-reviser/v3@latest`) |
| `golangci-lint`     | `*.go`                          | `golangci-lint`      (`brew install golangci-lint` or `go install`) |
| `eslint`            | `frontend/src/**/*.{js,vue}`    | `eslint`             (auto-installed by `cd frontend && npm ci`) |
| `stylelint`         | `frontend/src/**/*.{css,vue}`   | `stylelint`          (auto-installed by `cd frontend && npm ci`) |
| `spectral`          | `api/openapi.yaml`              | `npx @stoplight/spectral-cli` (auto-pulled on demand by `npx`) |
| `yamllint`          | `*.{yml,yaml}` (excl. openapi)  | `yamllint`           (`brew install yamllint` or `pip install yamllint`) |
| `hadolint`          | `Dockerfile*`                   | `hadolint`           (`brew install hadolint`) |
| `conventional`      | every commit                    | shell only (uses `grep -E`) |

If a tool isn't installed, the corresponding hook fails — install it (or skip the hook for one commit, see below).

**`commit-msg` hook — Conventional Commits format check** (this one runs against every commit, not just files):

Subject must match `<type>(<scope>)?(!)?: <description>`. Allowed types:

```
feat fix chore docs refactor test perf build ci revert style
```

Example valid messages:

```
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

```
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

Atomicity matters: each commit should describe **one** logical change. The big "feat:" omnibus commit in this repo's recent history (`04b5e50`) is a one-time onboarding bulk import and shouldn't set the cadence for normal contributions.

**Bypasses** (use sparingly):

```sh
LEFTHOOK=0 git commit -m "wip"                          # skip all hooks
LEFTHOOK_EXCLUDE=conventional git commit -m "fixup"     # skip just commit-msg
LEFTHOOK_EXCLUDE='conventional,golangci-lint' git ...   # skip multiple
```

Hooks bypassed locally will still fail in CI on push — bypass is for in-flight WIP commits, not a way around the rules.

### Tagging and releasing

Releases are automated by [release-please](https://github.com/googleapis/release-please). **You should never need to run `git tag` by hand.** The full flow:

```
conventional commits on main
    ↓
release-please.yml opens "chore(main): release vX.Y.Z" PR
    ↓
maintainer reviews + merges the PR
    ↓
release-please creates the vX.Y.Z tag
    ↓
release.yml builds binaries + DMG + container image
    ↓
GitHub Release published
```

Config lives in `release-please-config.json` and `.release-please-manifest.json`.

> **One-time repo setup**: GitHub blocks Actions from opening PRs by default. Enable
> **Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests"**
> or release-please will fail with *"GitHub Actions is not permitted to create or approve pull requests."* once it tries to open the Release PR.

#### Version-bump rules

release-please reads commit types since the last tag and bumps accordingly:

| Commit prefix | Pre-1.0 effect | Post-1.0 effect |
|---|---|---|
| `feat!:` or `BREAKING CHANGE:` footer | minor bump | **major** bump |
| `feat:` | minor bump | minor bump |
| `fix:`, `perf:` | patch bump | patch bump |
| `refactor:`, `docs:`, `test:`, `build:`, `ci:`, `revert:` | patch bump | patch bump |
| `chore:`, `style:` | no bump, hidden from changelog | same |

Until the project crosses `1.0.0`, breaking changes are minor bumps (per the `bump-minor-pre-major` flag in `release-please-config.json`). After 1.0.0, the strict SemVer rules apply.

#### Cutting a release

1. **Merge the Release PR**. release-please opens it titled `chore(main): release vX.Y.Z` whenever there are tag-bumping commits on `main`. The PR diff shows the version bump in `.release-please-manifest.json` and the additions to `CHANGELOG.md`.
2. **Review the changelog content** before merging — anything `chore:` or `style:` is hidden, anything else is grouped by type. If the changelog is missing a notable change, fix the underlying commit subject (amend + force-push, OR add an empty `git commit --allow-empty -m "fix: …"` if the original PR is already squashed in).
3. **Merge the PR** (squash). release-please then creates the `vX.Y.Z` git tag on the merge commit.
4. The tag fires `release.yml`. Wait for all jobs (`build-docker`, `build-mac`, `sbom`, `publish-container`, `release`) to go green — typically 8-15 minutes.
5. **Verify the GitHub Release**: `.dmg`, `.tar.gz`, `.deb`, `.exe`, SBOM, and per-artifact `.sha256` files should all be attached. The container image at `ghcr.io/<owner>/recall-server:vX.Y.Z` (plus `:latest`) should be present in Packages.

#### Cutting a prerelease (beta / rc / alpha)

release-please respects a [`Release-As:` commit footer](https://github.com/googleapis/release-please/blob/main/docs/customizing.md#release-as) that overrides the version it would otherwise compute. Use it to ship a prerelease without touching workflow config or maintaining a parallel branch:

```sh
git checkout main && git pull
git commit -s --allow-empty -m "chore: cut v0.0.9-beta.0

Release-As: 0.0.9-beta.0
"
git push origin main
```

What happens next:

1. release-please re-evaluates on the push, reads the `Release-As:` footer, and opens (or updates) a **Release PR** titled `chore(main): release v0.0.9-beta.0`.
2. The PR diff bumps `.release-please-manifest.json` to `0.0.9-beta.0` and adds a `## [0.0.9-beta.0]` heading to `CHANGELOG.md` listing every commit since the last release tag.
3. Merge the PR. release-please creates the `v0.0.9-beta.0` git tag.
4. `release.yml` fires on the `v*` tag. GitHub marks the resulting Release as a **prerelease** automatically because the tag has a hyphenated suffix — no separate workflow or flag needed.

The next beta in the same line: another empty commit with `Release-As: 0.0.9-beta.1`. The next *official* release: don't add any `Release-As:` footer — release-please bumps normally from the most recent tag (e.g. `v0.0.9` from `fix:` commits, `v0.1.0` from `feat:`). The absence of a hyphenated suffix in the tag is what makes a release "official" — the same `release.yml` builds the artifacts either way.

**Force a specific stable version** (e.g. jumping from `v0.1.5` straight to `v1.0.0`): same pattern, `Release-As: 1.0.0`.

#### Skipping or pausing release-please

- **Empty Release PR**: if no `feat:` / `fix:` / etc. commits have landed since the last tag, no PR opens. Add at least one tag-bumping commit (or `chore:` if you genuinely just want a re-tag — that won't trigger a version bump but you can manually edit the manifest).
- **Pausing**: close the Release PR without merging. It will re-open on the next push to `main` with the latest changes folded in.

#### Emergency manual tag (last resort)

Only do this if `release-please.yml` is broken or you need a hotfix tag before release-please catches up. The `release.yml` workflow fires on any `v*` tag.

```sh
git checkout main && git pull
git tag -a v0.1.1 -m "hotfix: …"
git push origin v0.1.1
```

After the manual tag, the next push to `main` will trigger release-please to reconcile `.release-please-manifest.json` against the new tag — you may see an unusual Release PR. Inspect it carefully before merging.

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

`make swagger` honors the `DOCKER` env var (`DOCKER=podman make swagger` works). Override the port with `SWAGGER_PORT=9090 make swagger`.

The spec also feeds the frontend's typed API client (`frontend/src/api.ts`). After editing `api/openapi.yaml`:

```sh
make gen-types     # regenerate frontend/src/api.gen.d.ts
make typecheck     # confirm api.ts still type-checks against the new shape
```

CI runs both and additionally fails if `api.gen.d.ts` is out of sync with the spec — so commit the regenerated `.d.ts` alongside any spec change.
