# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Recall is a Wails v2 desktop app that watches a folder of Overwatch 2
screenshots, OCRs them with Tesseract, merges per-match data into SQLite, and
optionally exposes the match history as Prometheus metrics so a bundled
Grafana dashboard can chart trends. Stack: Go backend + Vue 3 frontend
(Vite) + `modernc.org/sqlite` (pure-Go, no CGo) + Tesseract CLI shelled out
to. The user is a competitive OW2 player who wants the tool to surface what
they're good/bad at by hero/map/type.

## Build, run, dev

Two binary flavours exist, selected by the `serveronly` Go build tag:

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
| `make build-mac` | macOS Wails apps → `dist/mac/Recall-arm64.app` + `dist/mac/Recall-amd64.app`. Must run on macOS. |
| `make build-all-docker` | Linux + Windows Wails apps — no macOS SDK needed; good for CI. |
| `make build-server-linux` | Linux/amd64 server binary → `dist/server-linux/Recall-server` via Docker. |
| `make build-server-windows` | Windows/amd64 server binary → `dist/server-windows/Recall-server.exe` via Docker. |
| `make build-server-mac` | macOS server binaries (arm64 + amd64) → `dist/server-mac/` via Docker (no Apple SDK needed — pure Go). |
| `make build-server-all` | All three server builds via Docker. |
| `make build-server-container` | Linux server container image with Tesseract → `recall-server:local` (local Docker). |
| `make build-all` | All three Wails platforms (macOS host required). |
| `go build ./...` | Compile-check Wails variant (default tag). |
| `go build -tags serveronly ./...` | Compile-check server variant (no CGo, no Wails). |
| `go get <pkg>` | Add a Go dep. (`wails dev` runs `go mod tidy` on startup.) |
| `bash -n scripts/X.sh` | Syntax-check a shell script. |
| `brew bundle` | Install Tesseract, Go toolchain, Podman, etc. from `Brewfile`. **Wails CLI must be installed separately**: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`. |
| `cd frontend && npm ci` | Install frontend dependencies (required after clone or `make clean`). |
| `make fmt` | Format all Go source files (`go fmt ./...`). |
| `make lint` | Run all linters: golangci-lint (Go, both build tags), ESLint, Stylelint, HTMLHint, Hadolint. |
| `make clean` | Remove `dist/`, `build/bin/`, `frontend/dist`, and `frontend/node_modules`. |
| `make update-deps` | Update Go modules (`go get -u ./...` + `go mod tidy`) and npm packages. |
| `make trivy` | Trivy vulnerability scan (Go modules + npm + Dockerfile); fails on HIGH/CRITICAL. |

**Package layout (`pkg/`)**:

| Package | Contents |
|---|---|
| `pkg/app` | `App` struct, settings, match merging, `SSEHub`, Wails dialog methods |
| `pkg/cmd` | `RunWails` (Wails init) and `RunServer` (HTTP server + REST API) |
| `pkg/db` | SQLite `Init()` + `DB` variable |
| `pkg/metrics` | Prometheus `Collector` + `Server` |
| `pkg/parser` | OCR dispatcher, all screenshot parsers, Tesseract exec |

`Dockerfile.build` has 12 named stages. Stages 1–6 are the Wails builds (need CGo + WebView libs). Stages 7–11 are the `serveronly` builds — pure Go, `CGO_ENABLED=0`, cross-compiled on Linux for all three OS targets. The server stages inherit from `go-base` (module deps already downloaded) and need no apt packages. Stage 12 (`server-container`) is a `debian:bookworm-slim` runtime image with Tesseract pre-installed, used for Docker deployments.

**Environment variable overrides** (all optional, mainly for debugging):

| Var | Default | Effect |
|---|---|---|
| `RECALL_DEBUG_DIR` | system temp | Directory for Tesseract work files; set to a fixed path to inspect them after a parse run. |
| `OWMETRICS_DEBUG_DIR` | *(off)* | When non-empty, dumps raw Tesseract output `.txt` files into the work dir for each OCR call. |
| `OWMETRICS_METRICS_ADDR` | `:9091` | Override Prometheus metrics bind address (e.g. `OWMETRICS_METRICS_ADDR=:9292 wails dev`). |
| `RECALL_SERVER_ADDR` | `127.0.0.1:7000` | Override the HTTP server bind address. Set to `0.0.0.0:7000` when running inside Docker so the port is reachable from the host. |

There are no Go unit tests in-tree. Ad-hoc verification has historically
been done by writing a transient `x*_test.go` in the repo root that drives
`app.Startup` + `app.ParseScreenshots` + `app.GetMatchResults` (import `recall/pkg/app`), running it
with `go test -run ... -v`, and deleting the file. The
`/tmp/owm_test/` directory has been used for throwaway harness scripts.

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
`sr` (variable-length nested data). Schema is `CREATE TABLE IF NOT
EXISTS` — **column changes require deleting `recall.db` and re-parsing,
no migrations**.

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
and `POST /api/tesseract-path` respectively; `api.js` in the frontend uses
`window.prompt()` as a fallback when not in Wails.

**Wails-bound HTTP handler**: `ScreenshotHandler()` serves
`/_screenshot/<filename>` from the configured screenshots dir — used by
both the Wails `AssetServer.Handler` and the server-mode HTTP mux.

## Frontend (`frontend/src/App.vue`)

Single-file Vue 3 SFC, composition API. No router, no Vuex/Pinia — a few
`ref`s + `computed`s. State concerns:

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

## CI/CD (`.github/workflows/release.yml`)

Triggered on `v*` tags. Parallel jobs: `build-docker` (Linux + Windows Wails apps + all server binaries via Docker; packages Linux binaries as `.tar.gz` and `.deb` installing to `/usr/local/bin/`), `build-mac` (macOS Wails arm64 + amd64 `.app` bundles, requires Apple runner), `publish-container` (builds `server-container` stage and pushes to `ghcr.io/<owner>/recall-server` with semver tags — GHCR only, not attached to the release), and `release` (creates GitHub Release with all binaries; waits on `build-docker` + `build-mac`). GHCR auth uses `secrets.GITHUB_TOKEN` — no PAT needed; workflow permissions must include `packages: write`.

## Conventions worth knowing

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
- **Frontend imports from `'./api.js'`** (not directly from wailsjs).
  `api.js` is a transport-agnostic shim: in Wails mode it delegates to
  `window['go']['app']['App']` (package is now `app`, not `main`); in browser/server mode it uses
  `fetch('/api/...')` and `EventSource('/api/events')`. Adding a new exported
  method on `App` is a **three-step** process: (1) add the method to `pkg/app/app.go`,
  (2) run `wails dev` to regenerate `wailsjs/go/app/App.js` (delete old `wailsjs/go/main/` if present — the package moved from `main`→`app` and the stale bindings will not be auto-replaced),
  (3) add the corresponding wrapper to `frontend/src/api.js` — both the Wails delegation
  path (`window['go']['app']…`) and the `fetch` path. Skipping step 3 silently breaks
  server mode while Wails mode continues to work.
- **The `_screenshot/<filename>` URL prefix** is reserved for the
  on-disk screenshots handler. Don't reuse it for other dynamic assets.
- **`set -u` not `-e`** in shell scripts that should keep going after an
  individual failure (`verify-stack.sh` is the canonical example).
- **`loading="lazy"` breaks `v-if`-inserted images** — browsers assign
  zero viewport presence to `<img>` elements added to the DOM by `v-if`
  (zero intrinsic dimensions at mount time), so the Intersection Observer
  never fetches them. Any image that appears on an explicit user action
  must omit `loading="lazy"` (or use `loading="eager"`).
- **Vue 3 ref auto-unwrapping in templates** — in `<script setup>`, refs
  are auto-unwrapped at the template top level: `myRef` in a template
  expression already equals `myRef.value`. Writing `myRef.value[key]` in a
  template therefore double-unwraps and returns `undefined` silently.
  Always access `.value` inside a wrapper function in JS, then call the
  function from the template.
