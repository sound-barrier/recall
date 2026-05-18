# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

OWMetrics is a Wails v2 desktop app that watches a folder of Overwatch 2
screenshots, OCRs them with Tesseract, merges per-match data into SQLite, and
optionally exposes the match history as Prometheus metrics so a bundled
Grafana dashboard can chart trends. Stack: Go backend + Vue 3 frontend
(Vite) + `modernc.org/sqlite` (pure-Go, no CGo) + Tesseract CLI shelled out
to. The user is a competitive OW2 player who wants the tool to surface what
they're good/bad at by hero/map/type.

## Build, run, dev

| Command | Purpose |
|---|---|
| `wails dev` | Hot-reload dev server. Vite on `:5173`, Wails IPC dev on `:34115`. Auto-rebuilds Go on save. |
| `wails build` | Production `.app` in `build/bin/`. |
| `go build ./...` | Compile-check the Go side without launching the GUI. Use this for quick CI-style sanity. |
| `go get <pkg>` | Add a Go dep. (`wails dev` runs `go mod tidy` on startup.) |
| `bash -n scripts/X.sh` | Syntax-check a shell script. |
| `brew bundle` | Install Tesseract, Go toolchain, Podman, etc. from `Brewfile`. **Wails CLI must be installed separately**: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`. |

There are no Go unit tests in-tree. Ad-hoc verification has historically
been done by writing a transient `x*_test.go` in the repo root that drives
`app.startup` + `app.ParseScreenshots` + `app.GetMatchResults`, running it
with `go test -run ... -v`, and deleting the file. The
`/tmp/owm_test/` directory has been used for throwaway harness scripts.

## Data flow (the big-picture architecture)

```
screenshots/*.png
      │
      ▼  (Tesseract via parser.ParseScreenshot, dispatched per screenshot type)
parser.MatchResult
      │
      ▼  (app.go: mergeByTimestamp → splitByMatchMetadata → mergeByStatsSignature → findMergeIntoExisting)
SQLite match_results       ← source of truth
      │
      ├──→ Wails GetMatchResults() ──→ Vue UI (App.vue)
      │
      └──→ metrics.Collector reads on every Prometheus scrape ──→ Grafana
```

**SQLite is the source of truth.** The Prometheus collector reads it on
every scrape; nothing else writes to the TSDB. Filters (e.g.
competitive-only) live at the metrics boundary in
`backend/metrics/metrics.go::Collect`, **not** in the parser or DB — so
quickplay matches are visible in the Wails UI but never reach Grafana.

## How match merging works (the hard part)

A single match produces 3-5 screenshots (SUMMARY, TEAMS, PERSONAL ×N
heroes, optional rank screen). Each populates a disjoint subset of fields
on `parser.MatchResult`. `app.go` merges them into one DB row via three
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

## Per-screenshot-type parsers (`backend/parser/parser.go`)

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

## Database layer (`backend/db/db.go`)

Single `match_results` table, explicit columns for every scalar field on
`MatchResult`, JSON blobs for `heroes_played`, `performance`, `modifiers`,
`sr` (variable-length nested data). Schema is `CREATE TABLE IF NOT
EXISTS` — **column changes require `rm data/db/owmetrics.db` and re-parse,
no migrations**. The DB lives at `data/db/owmetrics.db` relative to the
process's cwd.

Match identity is `match_key TEXT NOT NULL UNIQUE` derived from the
earliest screenshot's filename timestamp (`match:2026-05-10T21:29:28`).
Orphan/unparseable rows get `unmatched:<filename>` as their key.

The `parsed_at` column is the row's insert/update time, not the match's
time — match time comes from `date` + `finished_at` (SUMMARY) or the
match_key timestamp prefix (fallback).

## Metrics layer (`backend/metrics/metrics.go`)

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

## Wails app shell (`app.go`)

`App` owns:
- `settings` (`data/settings.json`): screenshots dir, prometheus enabled,
  watch enabled. Each toggle is persisted to disk on change.
- `metricsServer` (nil unless the Prometheus toggle is on).
- File watcher state (`watcher`, `watchedDir`, `watchTimer`, `watchMu`)
  with a `watchDebounce = 60 * time.Second` debounce: any new
  `.png`/`.jpg` in the configured dir resets a timer; expiry runs
  `ParseScreenshots` and fires the `parse-complete` Wails event so the
  Vue side reloads.
- `parseMu` serializes `ParseScreenshots` (manual click + watcher fire
  can't overlap and race on the parsed-files set).

**Wails-bound methods (called from Vue via `wailsjs/go/main/App`)**:
`ParseScreenshots`, `GetMatchResults`, `GetScreenshotsDir`,
`PickScreenshotsDir`, `GetPrometheusEnabled`, `SetPrometheusEnabled`,
`GetWatchEnabled`, `SetWatchEnabled`.

**Wails-bound HTTP handler**: `ScreenshotHandler()` serves
`/_screenshot/<filename>` from the configured screenshots dir, wired
into `main.go`'s `AssetServer.Handler`. Used by `<img>` previews in the
Vue card detail.

## Frontend (`frontend/src/App.vue`)

Single-file Vue 3 SFC, composition API. No router, no Vuex/Pinia — a few
`ref`s + `computed`s. State concerns:

- **Filters**: dropdowns (mode/map/type/role/hero/result) + date range
  inputs + sort dir. `filterRefs` maps field name → ref so badge clicks
  share one `toggleFilter` handler.
- **Hero filter** matches both primary (`data.hero`) AND any secondary
  in `data.heroes_played[]` so picking Juno surfaces a Rialto match
  where she was the 46% second-fiddle. Same applies to the `heroes`
  computed that populates the dropdown.
- **Date filter** only matches rows with explicit `date + finished_at`
  (no `match_key` fallback), so undated rows are correctly excluded
  from date-windowed views — matching the card UI's behavior of not
  showing a timestamp for them.
- **Per-card expand state** + per-source-file image preview state (each
  in a plain object, reassigned on toggle for Vue reactivity).
- **Event subscription**: `EventsOn('parse-complete', load)` on mount,
  `EventsOff` on unmount — auto-refreshes the records list after the
  watcher fires an auto-parse.

## Bundled observability stack

`docker-compose.yml` (works with `podman-compose` too — the default we
test against) brings up Prometheus + Grafana with auto-provisioning.
Prometheus scrapes `host.docker.internal:9091/metrics`. Grafana
auto-loads the dashboard at `grafana/provisioning/dashboards/owmetrics.json`,
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
- **Frontend imports from `'../wailsjs/go/main/App'`** are auto-generated
  by `wails dev` on rebuild — adding a new exported method on `App`
  needs the dev server to regenerate them before the Vue side can use it.
- **The `_screenshot/<filename>` URL prefix** is reserved for the
  on-disk screenshots handler. Don't reuse it for other dynamic assets.
- **`set -u` not `-e`** in shell scripts that should keep going after an
  individual failure (`verify-stack.sh` is the canonical example).
