# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Recall is a Wails v2 desktop app that watches a folder of Overwatch
screenshots, OCRs them with Tesseract, merges per-match data into SQLite, and
optionally exposes the match history as Prometheus metrics so a bundled
Grafana dashboard can chart trends. Stack: Go backend + Vue 3 frontend
(Vite) + `modernc.org/sqlite` (pure-Go, no CGo) + Tesseract CLI shelled out
to. The user is a competitive OW player who wants the tool to surface what
they're good/bad at by hero/map/type.

The GitHub repo is `sound-barrier/recall` — used for
`gh api repos/sound-barrier/recall/...` calls (code-scanning alerts,
PRs, releases, etc.).

## Build, run, dev

Two binary flavors exist, selected by the `serveronly` Go build tag:

| Tag | Entry point | CGo | Description |
|---|---|---|---|
| *(default)* | `main.go` + `pkg/app/app_wails.go` | Yes | Full Wails desktop app |
| `serveronly` | `main_server.go` + `pkg/app/app_server.go` | No | Headless HTTP server (addr from `RECALL_SERVER_ADDR`, default `127.0.0.1:7000`) |
| *(none — both)* | `assets.go` | No | `//go:embed all:frontend/dist` — embedded FS shared by both variants |

| Command | Purpose |
|---|---|
| `make dev` | Hot-reload dev server (macOS only). Vite on `:5173`, Wails IPC dev on `:34115`. Auto-rebuilds Go on save. |
| `make build-linux` | Linux/amd64 Wails app → `dist/linux/Recall` via Docker. |
| `make build-windows` | Windows/amd64 Wails app → `dist/windows/Recall.exe` via Docker + mingw-w64. |
| `make build-mac` | macOS Wails app → `dist/mac/Recall-arm64.app`. Must run on macOS. |
| `make build-all-docker` | Linux + Windows Wails apps — no macOS SDK needed; good for CI. |
| `make build-server-linux` | Linux/amd64 server binary → `dist/server-linux/Recall-server` via Docker. |
| `make build-server-windows` | Windows/amd64 server binary → `dist/server-windows/Recall-server.exe` via Docker. |
| `make build-server-mac` | macOS arm64 server binary → `dist/server-mac/Recall-server-arm64` via Docker (no Apple SDK needed — pure Go). |
| `make build-server-all` | All three server builds via Docker. |
| `make build-server-container` | Linux server container image with Tesseract → `recall-server:local` (local Docker). |
| `make build-all` | All three Wails platforms (macOS host required). |
| `go build ./...` | Compile-check Wails variant (default tag). |
| `go build -tags serveronly ./...` | Compile-check server variant (no CGo, no Wails). |
| `go get <pkg>` | Add a Go dep. (`wails dev` runs `go mod tidy` on startup.) |
| `bash -n scripts/X.sh` | Syntax-check a shell script. |
| `brew bundle` | Install Tesseract, Go toolchain, Podman, etc. from `Brewfile`. **Wails CLI must be installed separately**: `go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0`. |
| `direnv allow` | Activate the repo's `.envrc` after cloning (or after editing it). All env var overrides are documented and commented out inside `.envrc`. |
| `cd frontend && npm ci` | Install frontend dependencies (required after clone or `make clean`). |
| `make fmt` | Format all source: Go (`goimports-reviser` then `gofumpt`) and shell scripts in `scripts/` (`shfmt -w -i 2 -ci -bn`). Sub-targets: `fmt-go`, `fmt-shell`. Install Go formatters with `go install mvdan.cc/gofumpt@latest` and `go install github.com/incu6us/goimports-reviser/v3@latest`; shfmt is in the Brewfile. |
| `make lint` | Run all linters: golangci-lint (Go, both build tags), ESLint, Stylelint, HTMLHint, shellcheck + shfmt diff (bash scripts in `scripts/`, driven by the project-root `.shellcheckrc`), Hadolint, yamllint, Spectral. |
| `make clean` | Remove `dist/`, `build/bin/`, `frontend/dist`, and `frontend/node_modules`. |
| `make update-deps` | Update Go modules (`go get -u ./...` + `go mod tidy`) and npm packages (`npm update` — updates `package-lock.json` within declared ranges; use `npx npm-check-updates -u` to also widen the ranges in `package.json`). |
| `make check-deps` | Compare pinned tool versions in `.devcontainer/postCreate.sh` (Wails CLI, hadolint, lefthook, trivy) against their latest GitHub releases. Exits 1 if any are behind. Go/Node rows are informational only. |
| `make trivy` | Trivy vulnerability scan (Go modules + npm + Dockerfile); fails on HIGH/CRITICAL. |
| `make cloc` | Count lines of source code (excludes deps, build artifacts, and generated files). |
| `make icon` | Resync `build/appicon.png` from `assets/icon.png` (1024×1024 via `sips`, macOS-only) and clear `build/windows/icon.ico` so Wails regenerates platform icons (`.icns` for macOS, `.ico` for Windows) on next `wails build`. |
| `make swagger` | Serve `api/openapi.yaml` via Swagger UI v5 in a container (`$(DOCKER) run`, default port `:8080`; override with `SWAGGER_PORT`). |
| `make lint-openapi` | Lint `api/openapi.yaml` via Spectral (`spectral:oas` + `.spectral.yaml`) with `--fail-severity=warn`. Also run as part of `make lint`. |
| `make test` | Run all tests: Go unit tests (`pkg/app/merge_test.go`, `pkg/app/validate_test.go`, `pkg/parser/parser_test.go`) + Vitest (`frontend/src/match-helpers.test.ts`). Parser golden-file integration tests skip unless `RECALL_FIXTURE_DIR` is set. |
| `make gen-types` | Regenerate `frontend/src/api.gen.d.ts` from `api/openapi.yaml` (uses `openapi-typescript`). Run after every spec edit; CI fails if the committed `.d.ts` is out of sync. |
| `make typecheck` | `vue-tsc --noEmit` — covers `.ts` files and `<script lang="ts">` blocks in `.vue` files. `allowJs: false` in tsconfig means no JS can be introduced silently. |

**Package layout (`pkg/`)**:

| Package | Contents |
|---|---|
| `pkg/app` | `App` struct, settings, match merging, `SSEHub`, Wails dialog methods |
| `pkg/cmd` | `RunWails` (Wails init) and `RunServer` (HTTP server + REST API) |
| `pkg/db` | SQLite `Init()` + `DB` variable |
| `pkg/metrics` | Prometheus `Collector` + `Server` |
| `pkg/parser` | OCR dispatcher, all screenshot parsers, Tesseract exec |

`.devcontainer/devcontainer.json` + `postCreate.sh` mirror the Brewfile
on a Debian + Docker-in-Docker base so the project can be developed
inside VS Code Dev Containers or GitHub Codespaces with zero host
install. The Wails GUI can't render inside the container (no display
surface); contributors there use `go run -tags serveronly . --server`
and access port 7000 via the forwarded host port. `make icon` is
macOS-only (uses `sips`) and skips in the container.

`Dockerfile.build` has 12 named stages. Stages 1–6 are the Wails builds (need CGo + WebView libs). Stages 7–11 are the `serveronly` builds — pure Go, `CGO_ENABLED=0`, cross-compiled on Linux for all three OS targets. The server stages inherit from `go-base` (module deps already downloaded) and need no apt packages. Stage 12 (`server-container`) is a `debian:bookworm-slim` runtime image with Tesseract pre-installed, used for Docker deployments.

**Environment variable overrides** (all optional, mainly for debugging):

| Var | Default | Effect |
|---|---|---|
| `RECALL_DEBUG_DIR` | system temp | Directory for Tesseract work files; set to a fixed path to inspect them after a parse run. |
| `OWMETRICS_DEBUG_DIR` | *(off)* | When non-empty, dumps raw Tesseract output `.txt` files into the work dir for each OCR call. |
| `OWMETRICS_METRICS_ADDR` | `:9091` | Override Prometheus metrics bind address (e.g. `OWMETRICS_METRICS_ADDR=:9292 wails dev`). |
| `RECALL_SERVER_ADDR` | `127.0.0.1:7000` | Override the HTTP server bind address. Set to `0.0.0.0:7000` when running inside Docker so the port is reachable from the host. |
| `DOCKER` | `docker` | Container runtime binary for `make build-*` targets. Set to `podman` when using Podman. |
| `RECALL_PPROF` | *(off)* | When set to anything truthy (`1`, `true`, any non-empty non-`0/false` value), mounts `net/http/pprof` handlers under `/debug/pprof/` in server mode. Off by default — never expose pprof publicly. |
| `RECALL_FIXTURE_DIR` | *(off)* | Directory of `.png` fixture screenshots for `TestParseScreenshot_GoldenFiles`. Each `foo.png` needs a sidecar `foo.png.golden.json`. Set `RECALL_FIXTURE_UPDATE=1` alongside to regenerate goldens. |

Go unit tests cover the merge / inference / classification helpers in
`pkg/app/merge_test.go`, the boundary path validators in
`pkg/app/validate_test.go`, and the parser's text-processing helpers
in `pkg/parser/parser_test.go`. Full-image parser tests live in
`pkg/parser/integration_test.go` and skip unless `RECALL_FIXTURE_DIR`
points at a directory of `.png` + `foo.png.golden.json` pairs. For
quick local exploration outside the test runner, a throwaway
`x*_test.go` in `pkg/app/` that imports `recall/pkg/app` directly and
calls `app.Startup` + `app.ParseScreenshots` still works — delete the
file when done so it doesn't accumulate.

## Data flow (the big-picture architecture)

```
screenshots/*.png
      │
      ▼  (Tesseract via parser.ParseScreenshot, dispatched per screenshot type)
parser.MatchResult
      │
      ▼  (pkg/app/app.go: mergeByTimestamp → splitByMatchMetadata → mergeByStatsSignature → findMergeIntoExisting)
SQLite match_results       ← source of truth
      │
      ├──→ Wails GetMatchResults() ──→ Vue UI (App.vue)
      │
      └──→ metrics.Collector reads on every Prometheus scrape ──→ Grafana
```

**SQLite is the source of truth.** The Prometheus collector reads it on
every scrape; nothing else writes to the TSDB. Filters (e.g.
competitive-only) live at the metrics boundary in
`pkg/metrics/metrics.go::Collect`, **not** in the parser or DB — so
quickplay matches are visible in the Wails UI but never reach Grafana.

## How match merging works (the hard part)

A single match produces 3-5 screenshots (SUMMARY, TEAMS, PERSONAL ×N
heroes, optional rank screen). Each populates a disjoint subset of fields
on `parser.MatchResult`. `pkg/app/app.go` merges them into one DB row via three
sequential passes:

1. **`mergeByTimestamp`** — groups screenshots whose filename timestamps
   are within `mergeWindow` (2 min) of each other. Captures sequential
   post-match tab clicks.
2. **`splitByMatchMetadata`** — re-splits any group that contains
   conflicting `(date, finished_at)` signatures. Catches the
   back-to-back-matches case where two SUMMARY screens land in one
   timestamp window (we hit this with Rialto + Aatlis only 13 s apart).
3. **`mergeByStatsSignature`** — folds rows that share `(eliminations,
   assists, deaths)` plus compatible map/date/hero. Bridges the in-game
   scoreboard (taken mid-match) to its post-match SUMMARY/TEAMS/PERSONAL
   group, which can be tens of minutes apart.

Then the loop in `ParseScreenshots` tries to merge each new `mergedRow`
into an *existing* DB row via `findMergeIntoExisting` (same two criteria:
E/A/D signature OR timestamp window with no metadata conflict). This is
what makes the Parse button idempotent — re-clicking doesn't duplicate;
adding one new screenshot to an existing match's group folds it in.

**`mergeMatchResult`** uses "first non-empty wins" for scalars and a
hero-keyed merge for `heroes_played` (so each hero's stats stay distinct
across multi-hero matches).

## Per-screenshot-type parsers (`pkg/parser/parser.go`)

`ParseScreenshot` dispatches by detector probes:

- **Rank screen** (`isRankScreenshot` → `parseRank`): the competitive
  ladder badge + per-hero SR card.
- **SUMMARY tab** (`isSummaryScreenshot` → `parseSummary`): heroes
  played, total performance averages, map/result/score/date/game-length
  card.
- **PERSONAL tab** (`isPersonalScreenshot` → `parsePersonal`): 3×3 grid
  of hero-specific stat cards. Each cell gets dual-pass OCR (PSM 11 +
  PSM 6) plus an icon-stripped pass to recover labels Tesseract mangles
  against the icon glyphs (Juno's orbital-ring icon turning "ORBITAL"
  into "ornBITAL" is the canonical example).
- **In-game / post-match TEAMS scoreboard** (fall-through →
  `parseScoreboard`): finds the highlighted player row by brightest
  blue, OCRs the six stat columns, plus the right-hand panel which
  carries hero-specific stats on the in-game version.

OCR helpers: `ocrInverted` (default — luminance-inverted + 3× upscaled,
ideal for white-on-dark game UI), `ocrRaw` (raw color + 2× upscaled, used
where the inverted preprocess flattens too much, e.g. the magenta
COMPETITIVE badge). Tesseract is shelled out via `exec.Command` — no
CGo binding.

**OCR fragility patterns to know about:**
- Letter↔digit confusion in italic OW font: `digitize()` swaps O/Q/I/l/L
  back to digits in numeric captures.
- "AVG PER 10 MIN: X.XX" lines need to be anchored on `MIN` so the `10`
  isn't grabbed as the value.
- Cells where Tesseract drops the main integer (skull-X icon next to the
  17 in ELIMINATIONS): `parsePerformance` picks the *last pure-digit
  line* before the label, ignoring noise-lines like `"S 4"`.
- macOS `/tmp` is symlinked to `/private/tmp`; Tesseract sometimes
  fails to read PNGs at `/tmp/...` paths but works at `/private/tmp/...`.
  Affects debug runs only — production uses `os.MkdirTemp`.

## Database layer (`pkg/db/db.go`)

Single `match_results` table, explicit columns for every scalar field on
`MatchResult`, JSON blobs for `heroes_played`, `performance`, `modifiers`,
`sr`, `source_types` (variable-length nested data). Schema is
`CREATE TABLE IF NOT EXISTS` plus an idempotent `migrations` slice in
`pkg/db/db.go` for in-place `ALTER TABLE ADD COLUMN` — "duplicate column"
errors are swallowed so existing DBs upgrade on next launch. Append a new
statement to that slice when adding a column; only DROP/RENAME or NOT
NULL changes still require wiping `recall.db`.

Per-source-file screenshot type is stored in the JSON `source_types`
column — `map[filename]type` where type ∈ {`summary`, `scoreboard`,
`personal`, `rank`}. Populated by `screenshotType(*MatchResult)` at
parse time, threaded through `mergedRow.Types`, surfaced as
`MatchRecord.SourceTypes` to the frontend. Rows parsed before this
column landed have `source_types=NULL`; the frontend renders a "?"
chip and `detectScreenshotSlots()` falls back to field-presence
inference for those rows.

The DB lives at `<appDataDir>/db/recall.db` where `appDataDir()` in `pkg/app/app.go`
resolves to the platform user-config directory:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Recall/db/recall.db` |
| Linux | `~/.config/recall/db/recall.db` (or `$XDG_CONFIG_HOME/recall/db/`) |
| Windows | `%AppData%\Recall\db\recall.db` |

Match identity is `match_key TEXT NOT NULL UNIQUE` derived from the
earliest screenshot's filename timestamp (`match:2026-05-10T21:29:28`).
Orphan/unparseable rows get `unmatched:<filename>` as their key.

The `parsed_at` column is the row's insert/update time, not the match's
time — match time comes from `date` + `finished_at` (SUMMARY) or the
match_key timestamp prefix (fallback).

## Metrics layer (`pkg/metrics/metrics.go`)

Custom `prometheus.Collector` whose `Collect()` reads SQLite via a
`Reader` closure on every scrape. Every match emits N samples
(eliminations, assists, deaths, damage, healing, mitigation, result,
rank_level, percent_played × hero, sr × hero, hero_stat × hero × stat),
each `prometheus.NewMetricWithTimestamp`-wrapped with the match's
`finished_at` time — **not scrape time**. Requires Prometheus's
out-of-order ingestion window to be large enough; `prometheus.yml` sets
`storage.tsdb.out_of_order_time_window: 8760h`.

**Filter point**: `Collect` skips rows where `Mode != "competitive"`. This
is the only place modes are filtered for Prometheus.

`metrics.NewServer(addr, reader)` builds the HTTP server but **doesn't
bind**. `Start()` listens in a goroutine; `Stop()` does a 2 s graceful
shutdown. `http.Server` can't be reused after `Shutdown`, so each
enable→disable→enable cycle constructs a fresh `Server`.

## App shell (`pkg/app/`)

`App` owns:
- `settings` (`<appDataDir>/settings.json`): screenshots dir, tesseract path, prometheus
  enabled, watch enabled. Each toggle is persisted to disk on change. `appDataDir()`
  resolves to `~/Library/Application Support/Recall/` on macOS, `~/.config/recall/`
  on Linux, `%AppData%\Recall\` on Windows.
- `metricsServer` (nil unless the Prometheus toggle is on).
- File watcher state (`watcher`, `watchedDir`, `watchTimer`, `watchMu`)
  with a `watchDebounce = 60 * time.Second` debounce: any new
  `.png`/`.jpg` in the configured dir resets a timer; expiry runs
  `ParseScreenshots` and calls `a.emitParseComplete()`.
- `parseMu` serializes `ParseScreenshots` (manual click + watcher fire
  can't overlap and race on the parsed-files set).
- `SSEHub *SSEHub` — non-nil in server mode; the SSE hub that broadcasts
  `parse-complete` events to connected browser tabs.

**Build-tag split** — methods that touch the Wails runtime live in separate files:

| File | Tag | Contains |
|---|---|---|
| `pkg/app/app.go` | *(none)* | All portable App methods; calls `a.emitParseComplete()` (abstract) |
| `pkg/app/app_wails.go` | `!serveronly` | `emitParseComplete` (wruntime.EventsEmit + SSEHub), `PickTesseractBinary`, `PickScreenshotsDir` |
| `pkg/app/app_server.go` | `serveronly` | `emitParseComplete` (SSEHub only), stub errors for the two dialog methods |
| `pkg/app/sse.go` | *(none)* | Exported `SSEHub` type with `Subscribe/Unsubscribe/Broadcast` |

**Wails-bound methods (called from Vue via `wailsjs/go/app/App`)**:
`ParseScreenshots`, `GetMatchResults`, `GetScreenshotsDir`,
`PickScreenshotsDir`, `GetPrometheusEnabled`, `SetPrometheusEnabled`,
`GetWatchEnabled`, `SetWatchEnabled`,
`GetTesseractStatus`, `SetTesseractPath`, `PickTesseractBinary`,
`ResetTesseractPath`, `ClearDatabase`, `GetNewScreenshotCount`.

**App constructor**: `app.New()` in `pkg/app` (was `NewApp()` in root).

**HTTP server mode** (`pkg/cmd/server.go` — `RunServer(a *app.App, assets embed.FS)`): called when
`-s`/`--server` is passed to the Wails binary, or always when compiled
`serveronly`. Starts `net/http` on the address from `RECALL_SERVER_ADDR` (default `127.0.0.1:7000`), serves the embedded
frontend, exposes every App method as a JSON REST endpoint under `/api/`,
and streams `parse-complete` via `GET /api/events` (SSE). `PickScreenshotsDir`
and `PickTesseractBinary` (native dialogs) are replaced by `POST /api/screenshots-dir`
and `POST /api/tesseract-path` respectively; `api.ts` in the frontend uses
`window.prompt()` as a fallback when not in Wails.

The full HTTP surface is documented in **`api/openapi.yaml`** (OpenAPI
3.1.0, hand-written). Treat that file as the source of truth: when
adding/removing a route in `pkg/cmd/server.go` or changing a response
shape in `pkg/app/app.go` / `pkg/parser/parser.go`, edit the spec to
match. `make lint-openapi` runs Spectral against it (strict on warnings
— the `spectral:oas` ruleset emits most useful issues as warnings, not
errors, so the `--fail-severity=warn` flag in the Makefile is
deliberate). `make swagger` renders the spec in Swagger UI for
browsing.

**Wails-bound HTTP handler**: `ScreenshotHandler()` serves
`/_screenshot/<filename>` from the configured screenshots dir — used by
both the Wails `AssetServer.Handler` and the server-mode HTTP mux.

## Frontend (`frontend/src/App.vue`)

Pure helpers (date formatting, screenshot-type detection, hero sorting,
etc.) live in `frontend/src/match-helpers.ts` so they can be unit-tested
in isolation via Vitest. `App.vue` imports them at the top of
`<script setup lang="ts">`. When adding a new pure helper that takes plain
inputs and returns plain outputs, add it to `match-helpers.ts` and write a
Vitest case in `match-helpers.test.ts` — don't define it inside the SFC's
`<script setup>`. The entire frontend is TypeScript (`allowJs: false`);
ESLint uses `typescript-eslint` (`tseslint.config()` in `eslint.config.js`)
with `parserOptions.parser: tseslint.parser` wired in for `.vue` files.
Template access to `Record<string, Ref<string[]>>` filter state goes through
`filterList(field)` / `filterSearchStr(field)` helpers to satisfy
`noUncheckedIndexedAccess` without littering the template with `!` or `??`.

Single-file Vue 3 SFC, composition API. No router, no Vuex/Pinia — a few
`ref`s + `computed`s. State concerns:

- **Nav** — four tabs in workflow order: **Settings (01)** (screenshots
  folder + theme), **Ingest (02)** (engine / parse / export / data),
  **Matches (03)** (default landing tab), **Unknown (04)** (triage). The
  view ref defaults to `'matches'`; the numbering communicates the user
  flow, not tab order of importance. Settings and Ingest both wear
  `class="settings"` for shared layout but Ingest gets the modifier
  `ingest-view` so the Futura font scope (`.settings:not(.unknown-view,
  .ingest-view)`) stays on the actual Settings tab.
- **Filters**: multi-select popovers (mode/map/type/role/hero/result) +
  date range inputs + sort dir. Each filter field is a `ref([])` — empty
  array = no filter, multiple entries = union (OR logic). `filterRefs`
  maps field name → ref so `toggleFilter(field, value)` and card badge
  clicks share one handler that toggles array membership. `openFilter`
  tracks which popover is currently open (one at a time); outside-click
  and ESC close it via document-level listeners registered in `onMounted`.
- **Hero filter** matches primary (`data.hero`) OR any secondary in
  `data.heroes_played[]` against the full set of selected heroes — so
  picking Juno + Kiriko surfaces matches where either was played, even as
  a second-fiddle. Same union logic powers the `heroes` computed.
- **Date filter** only matches rows with explicit `date + finished_at`
  (no `match_key` fallback), so undated rows are correctly excluded
  from date-windowed views — matching the card UI's behavior of not
  showing a timestamp for them.
- **Settings page**: engine (Tesseract path + status), screenshots
  directory, watch-folder toggle, manual parse button, Grafana/Prometheus
  toggle. Matches view retains all filters and the match list.
- **Tesseract gate**: `tesseractReady` computed drives a System Alert
  banner and disables Parse/Watch controls when the OCR engine isn't
  found. `GetTesseractStatus` / `SetTesseractPath` / `PickTesseractBinary`
  / `ResetTesseractPath` are the four Wails-bound methods for engine config.
- **Unknown Maps view**: records where `data.map` is absent surface in a
  separate Unknown Maps page via the `unknownRecords` computed. It has its
  own `unknownExpanded`/`unknownPreviewOpen`/`unknownPreviewError` state
  parallel to the Matches view state, so collapsing all matches doesn't
  disturb the triage view.
- **Per-card expand state** + per-source-file image preview state (each
  in a plain object, reassigned on toggle for Vue reactivity).
  `screenshotURL(filename)` returns `/_screenshot/<encoded>` which the
  Wails AssetServer (or server-mode mux) serves via `ScreenshotHandler()`.
- **Event subscription**: `EventsOn('parse-complete', load)` on mount,
  `EventsOff` on unmount — auto-refreshes the records list after the
  watcher fires an auto-parse.
- **Custom fonts are loaded via `local()` first.** `frontend/src/style.css`
  registers three OW typefaces (`Big Noodle Too Oblique` for hero/map
  names, `Futura No. 2 Demi` for the Settings tab, `OW Wordmark` for the
  RECALL masthead) with a fallback chain: licensed `local()` lookup →
  bundled `./assets/fonts/*.woff2` (drop-in slot for the licensed files)
  → Google Fonts free lookalikes loaded via `index.html` (Barlow
  Condensed italic, Jost, Russo One). Keep all three layers when
  reworking the font stack.

## Bundled observability stack

`docker-compose.yml` (works with `podman-compose` too — the default we
test against) brings up Prometheus + Grafana with auto-provisioning.
Prometheus scrapes `host.docker.internal:9091/metrics`. Grafana
auto-loads the dashboard at `grafana/provisioning/dashboards/recall.json`,
which is purposely designed for sparse historical data (lines with
`spanNulls: true`, range queries that work across stale samples, tables
that surface "worst maps/heroes by win rate" for the educational use
case).

## Helper scripts in `scripts/`

| Script | What it does |
|---|---|
| `stack-up.sh` | Start podman VM if needed, slam VM clock to host time (default NTP peer drifts ~77 s), apply the gcloud-credential-helper workaround if needed, `podman-compose up -d`. |
| `stack-down.sh` | `podman-compose down`. Add `--machine` to also stop the VM. |
| `prometheus-clear.sh` | Tears down stack, removes the `*_prometheus_data` volume (preserves Grafana state), restarts. |
| `verify-stack.sh` | Layer-by-layer diagnostic: SQLite → /metrics → Podman container → Prometheus scrape state → TSDB sample count. Read-only. Run this first whenever Grafana shows no data. |
| `db-list.sh` / `db-show.sh` / `db-delete.sh` / `db-export.sh` / `clear-db.sh` | SQLite CRUD helpers. `db-show` accepts id, match_key, or filename substring; `db-export` emits one rebuilt JSON object per row. |
| `_lib.sh` | Shared `docker_config_aside()` helper used by stack-up and prometheus-clear to work around the gcloud cred-helper trap (see Troubleshooting in README). |
| `check-deps.sh` | Compares pinned tool versions (Wails CLI, hadolint, lefthook, trivy) in `postCreate.sh` against latest GitHub releases. Called by `make check-deps`. |

## CI/CD (`.github/workflows/`)

Three workflows:

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push or PR to `main` | **Lint** (golangci-lint × both build tags, ESLint + typescript-eslint, Stylelint, HTMLHint, Hadolint, yamllint, Spectral) → **frontend build** → **bundle-size budget** (200 KB JS / 100 KB CSS) → **Go + Vitest unit tests** → **TypeScript `vue-tsc --noEmit`** → **"api.gen.d.ts in sync with `openapi.yaml`" check**. Plus parallel build jobs for Linux/Windows Wails + all server binaries + container image + macOS Wails. Security jobs: **Trivy** (multi-language vuln scan; SARIF uploaded to GitHub Security tab) and **govulncheck** (Go call-graph-aware CVE scan, both build tags). Drift job: **schemathesis** fuzzes a freshly-built server against `api/openapi.yaml`. |
| `release-please.yml` | Push to `main` | Reads Conventional Commits since the last tag, opens/updates a Release PR that bumps `.release-please-manifest.json` + regenerates `CHANGELOG.md`. Merging the PR creates a `vX.Y.Z` tag which fires `release.yml`. Override the computed version with a `Release-As: X.Y.Z[-suffix]` footer in any commit on `main` — useful for one-off prereleases (the hyphenated suffix is what makes GitHub flag the Release as prerelease). Shortcut: `make release-beta VERSION=…`. Full procedure in [RELEASES.md](RELEASES.md). **Note:** release-please PRs show no CI jobs — GitHub does not trigger `pull_request` workflows for `GITHUB_TOKEN`-authored events; the underlying commits were already tested on push to `main`. |
| `release.yml` | `v*` tags | Builds and publishes release artifacts — see detail below. |

### `release.yml` detail

Triggered on `v*` tags (push) and on `workflow_dispatch` (manual fallback for when release-please's `GITHUB_TOKEN`-authored tag failed to chain — `make release-fire TAG=…`). Parallel jobs: `build-docker` (Linux + Windows Wails apps + all server binaries via Docker; packages Linux binaries as `.tar.gz` and `.deb` installing to `/usr/local/bin/`), `build-mac` (macOS Wails arm64 `.app` bundle wrapped in a `.dmg` via `hdiutil`, requires Apple runner), `sbom` (generates `recall-{version}-sbom.spdx.json` via `anchore/sbom-action` — SPDX JSON covering Go modules + npm packages), `publish-container` (builds `server-container` stage and pushes to `ghcr.io/<owner>/recall-server`: every tag publishes the exact `:{{version}}`; rolling `:{{major}}.{{minor}}` and `:latest` only push on stable releases — prerelease tags (those with a hyphen, e.g. `v0.1.0-beta.0`) are guarded by `enable=${{ !contains(github.ref_name, '-') }}` so `docker pull recall-server:latest` always lands on a non-prerelease build. See [RELEASES.md](RELEASES.md) → "Stable vs. prerelease at a glance" for the full matrix. GHCR only, not attached to the release; attempts to set visibility to public via API with `continue-on-error` — `GITHUB_TOKEN` lacks the `write:packages` OAuth scope for visibility changes, so the package must be set public once manually via GitHub Package settings), and `release` (waits on `build-docker` + `build-mac` + `sbom`; generates a per-artifact `<filename>.sha256` file for every binary and package — not for the SBOM; uploads all to GitHub Releases). All release artifacts embed the tag version in their filename: `recall-{version}-linux-amd64.tar.gz`, `recall-{version}-darwin-arm64.dmg`, etc. (`v` prefix stripped from the tag). GHCR auth uses `secrets.GITHUB_TOKEN` — no PAT needed; workflow permissions must include `packages: write`.

## Conventions worth knowing

- **TypeScript 6.x is blocked by `openapi-typescript`.** `openapi-typescript@7.x` declares `peer typescript: "^5.x"` and will cause `npm install` to fail with an `ERESOLVE` conflict if `typescript` is bumped to `^6.x`. Hold TypeScript at `^5.x` until `openapi-typescript` ships TS 6 support.

- **Match key is identity** — never key on filename; the match key
  derives from the earliest screenshot's filename timestamp and survives
  re-parses.
- **Per-screenshot detection runs in order**: rank → summary → personal
  → scoreboard fallback. `isXScreenshot` probes are cheap (one OCR pass
  on a small region) and read-only.
- **Hero list ordering** in `heroes_played` is by `percent_played` desc
  (set by `parseSummary`). The "primary hero" stored at `data.hero` is
  the first/most-played entry. UI relies on this; don't shuffle.
- **`parser.HeroRole(hero string)`** is the exported way to get a hero's
  role label from outside the parser package. Don't reach into the
  unexported `heroRoles` map.
- **Frontend imports from `'./api'`** (resolves to `frontend/src/api.ts`,
  not directly from wailsjs). `api.ts` is a transport-agnostic shim
  typed against the OpenAPI spec via `api.gen.d.ts` (regenerated by
  `make gen-types`): in Wails mode it delegates to
  `window['go']['app']['App']`; in browser/server mode it uses
  `fetch('/api/...')` and `EventSource('/api/events')`. Adding a new
  exported method on `App` is a **four-step** process: (1) add the
  method to `pkg/app/app.go`, (2) run `wails dev` to regenerate
  `wailsjs/go/app/App.js` (delete `wailsjs/go/main/` if it still
  exists — the package moved from `main`→`app`), (3) add the route +
  schema to `api/openapi.yaml` and run `make gen-types` to refresh
  `api.gen.d.ts`, (4) add the typed wrapper to `frontend/src/api.ts`
  — both the Wails delegation path (`window.go.app.App…`) and the
  `fetch` path. Skipping step 4 silently breaks server mode while
  Wails mode continues to work.
- **The `_screenshot/<filename>` URL prefix** is reserved for the
  on-disk screenshots handler. Don't reuse it for other dynamic assets.
- **HTTP array responses initialize to `make([]T, 0)`, never `var x []T`.**
  A nil slice JSON-marshals to `null`, which violates any OpenAPI
  `type: array` declaration and fails schemathesis's
  `response_schema_conformance` check in CI. `readAllRecords` in
  `pkg/app/app.go` is the canonical example. Same rule for any new
  `/api/*` endpoint that returns a list.
- **Bad client or config input is 4xx, not 5xx.** App-layer code returns
  a typed sentinel error (e.g. `app.ErrInvalidScreenshotsDir`,
  `fmt.Errorf("%w: ...", sentinel, ...)`); HTTP handlers use
  `errors.Is` to map the sentinel to 400 and let other errors fall
  through to 500. 5xx is reserved for unexpected internal failures —
  anything reproducibly triggered by fuzzed or user-config input is a
  4xx. Pattern established by the `/api/screenshots-dir` and `/api/parse`
  handlers.
- **Smoke-test the server with isolated HOME.** Running `recall-server`
  from the repo root hits real user data: the default `ScreenshotsDir =
  "screenshots"` resolves to `./screenshots` (which exists locally), and
  settings + SQLite live under `$HOME/Library/Application Support/Recall/`
  on macOS. To test fresh-install behavior without touching real data:
  `HOME=/tmp/recall-smoke RECALL_SERVER_ADDR=127.0.0.1:7099 ./recall-server`
  from a directory with no `./screenshots`. Clean up with `rm -rf
  /tmp/recall-smoke/Library`.
- **`set -u` not `-e`** in shell scripts that should keep going after an
  individual failure (`verify-stack.sh` is the canonical example).
- **`loading="lazy"` breaks `v-if`-inserted images** — browsers assign
  zero viewport presence to `<img>` elements added to the DOM by `v-if`
  (zero intrinsic dimensions at mount time), so the Intersection Observer
  never fetches them. Any image that appears on an explicit user action
  must omit `loading="lazy"` (or use `loading="eager"`).
- **Read-time inference, not merge-time.** Some derived fields are filled
  by helpers in `pkg/app/app.go` (`inferSoleHeroPercent`,
  `inferResultFromRank`) that run on the way *out* of the DB via
  `GetMatchResults` and `scrapeReader` — never inside `mergeMatchResult`
  or `loadExistingMergedRows`. Reason: storing the inferred value would
  break the merge's first-non-empty-wins rule when a later screenshot
  arrives with the real value (e.g. an inferred `result="victory"` from
  SR change would block a SUMMARY's authoritative `result` from
  overriding the stored value). New inference helpers belong on this
  read-time path.
- **Wails AssetServer custom routes need Middleware, not Handler, in
  dev mode.** `assetserver.Options.Handler` only fires when the dev
  proxy returns 404/405, but Vite's SPA fallback returns the bundled
  `index.html` with `200 OK` for unknown routes — so any path-prefixed
  handler (e.g. `/_screenshot/`) never runs and the browser receives
  HTML labeled as the asset's content-type. The Wails desktop wiring
  in `pkg/cmd/wails.go` registers `ScreenshotHandler` as a Middleware
  that short-circuits before the proxy. Production builds work either
  way; only `wails dev` needs the middleware pattern.
- **`screenshotType(r)` must check E/A/D before hero stats.**
  Scoreboard parses populate both `r.Eliminations/Assists/Deaths` and
  `r.HeroesPlayed[*].Stats` (the right-side panel cards). A
  hero-stats-first check would mis-classify every scoreboard with a
  populated panel as `personal`. Order: rank → summary → scoreboard
  (E/A/D) → personal (hero stats) → unknown.
- **`wails dev` takes ~12-14 s** before its AssetServer (`:34115`)
  responds. When probing routes via `curl` from a script, sleep at
  least 14 s after starting the dev server. Vite (`:5173`) is up
  faster but doesn't see custom handlers.
- **Commits follow Conventional Commits *plus* the [Linux kernel
  commit guidelines](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#describe-your-changes).**
  Conventional Commits governs the subject prefix
  (`<type>(<scope>)?(!)?: <description>`, allowed types: `feat`,
  `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`,
  `ci`, `revert`, `style`) and is enforced by lefthook's
  `commit-msg` hook. Kernel style governs everything below: subject
  ≤ 72 chars in imperative mood with no trailing period, blank line,
  body wrapped at 72 chars explaining *why* not *what*, kernel-style
  trailers (`Fixes: <sha> ("subject")`, `Reported-by:`,
  `Reviewed-by:`, `Signed-off-by:`, `Co-Authored-By:`) at the bottom.
  One logical change per commit. `release-please` reads the
  Conventional prefix to compute version bumps + regenerate
  `CHANGELOG.md`. Bypass once with `LEFTHOOK_EXCLUDE=conventional
  git commit …`. See CONTRIBUTING.md → "Pre-commit hooks (lefthook)"
  for the full example.
- **Bundle-size budget is enforced in CI.** `frontend/dist/assets/*.js`
  must stay under 200 KB; `*.css` under 100 KB (set in `ci.yml` step
  "Enforce bundle-size budget"). Bump the budgets explicitly when a
  real feature needs the room — don't accidentally regress past the
  current ~118 KB JS / ~63 KB CSS.
- **Vue 3 ref auto-unwrapping in templates** — in `<script setup>`, refs
  are auto-unwrapped at the template top level: `myRef` in a template
  expression already equals `myRef.value`. Writing `myRef.value[key]` in a
  template therefore double-unwraps and returns `undefined` silently.
  Always access `.value` inside a wrapper function in TypeScript, then call the
  function from the template.
- **User-controlled paths from HTTP go through a boundary validator
  before reaching `exec.Command` / `os.Stat`.** `validateScreenshotsDir`
  and `validateTesseractPath` in `pkg/app/app.go` are the canonical
  examples: shared `safePathChars` regex + `filepath.Clean` equality +
  return the cleaned value so the *sanitized* form is what downstream
  syscalls see (not the raw input). This is the pattern CodeQL's
  `go/command-injection` and `go/path-injection` rules recognize as a
  sanitizer. New HTTP endpoints that accept a filesystem path must
  follow the same shape — re-use `safePathChars` so the regex stays
  permissive enough for Windows `Program Files (x86)\…` paths and
  usernames with apostrophes/parens.
- **Windows Tesseract installer paths contain spaces and parens** —
  `defaultTesseractPath()` returns `C:\Program Files\Tesseract-OCR\…`
  or `C:\Program Files (x86)\Tesseract-OCR\…` on Windows. Any regex
  that constrains path strings must allow `() ` or it'll reject the
  Windows default out of the box (one of the test cycles spent
  tracking this down — don't repeat).
- **`gh workflow run --ref TAG` reads the workflow definition from
  that ref.** A `workflow_dispatch:` trigger added later on `main`
  is invisible to tags cut before the trigger landed — those refs
  can't be fired manually, only re-pushed (destructive). Current
  cutoff: `workflow_dispatch:` exists in `release.yml` from
  `v0.0.12-beta.0` onward. [RELEASES.md](RELEASES.md) →
  "When `release.yml` doesn't auto-fire" has the full procedure.
