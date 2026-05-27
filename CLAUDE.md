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

## Working style

This section is prescriptive — these are the project's defaults for
how new code should be written and how changes should be made.
Override only when the user explicitly asks for something different.

### Code style

- **Go**: follow [Effective Go](https://go.dev/doc/effective_go).
  Accept interfaces, return structs. Small interfaces (1–3 methods).
  Composition over inheritance. Embedding only for behavior delegation,
  never just to store a field. No premature abstraction — three similar
  lines beat one abstract one.
- **TypeScript / Vue**: idiomatic TS — no `any`, narrow types at
  boundaries (`Pick<>` or permissive interfaces so callers aren't
  forced to satisfy fields the function never reads). Composition API
  - composables for stateful logic. Pure helpers in
  `frontend/src/match-helpers.ts`, never inside an SFC's
  `<script setup>`.
- **Comments**: default to none. Only when the WHY is non-obvious — a
  hidden constraint, a surprising invariant, a workaround for a
  specific bug. Never re-explain WHAT the code does; well-named
  identifiers already do that.

### Design principles

- **SRP / DIP — dependency-inject seams that make testing possible.**
  Production wires the real implementation; tests wire a fake. Examples
  already in the codebase: the `db.Store` interface threaded into
  `*App` via `NewWithStore`; the `mountApp` helper's
  `vi.doMock('./api', …)` boundary for SFC tests.
- **Prefer function-variable seams over interfaces for one-method
  dependencies** (duck typing in Go). When the seam has a single method
  and a single fake, introducing an interface is YAGNI. Examples:
  `runTesseractFunc` and `parseSingleFunc` in
  `pkg/parser/tesseract.go` / `parser.go` — both swap a real impl for a canned one in
  tests without ceremony.
- **Law of Demeter — accept what you read.** When a composable returns
  many refs/handlers, bundle them as a single typed prop
  (the `CardStateApi`, `FiltersApi`, `GroupingApi` pattern in
  `MatchesView.vue`) rather than threading 30 individual props through.
  Consumers treat the bundle as opaque; don't reach through it for
  unrelated state.
- **DRY with the rule of three.** Don't extract a helper or interface
  on the second occurrence — two is coincidence. The
  `useTheme` / `useWeekStart` / `useIncludeUndated` family earned the
  abstraction when it hit three persisted-preference composables;
  before that it was just two `ref + localStorage` blocks.
- **YAGNI — hard line.** No speculative interfaces, no "just in case"
  error handling for conditions that can't occur, no
  backwards-compatibility shims for code that hasn't been deployed.
  If a feature is needed, the user will ask. Until then, simpler.

### TDD process

For **new features and bug fixes**:

1. **RED first.** Write a failing test that reproduces the bug or
   demonstrates the feature's contract. Run it. Watch it fail with a
   message that names the gap.
2. **GREEN minimal.** Write the smallest production code change that
   makes the test pass. Resist scope creep.
3. **REFACTOR if it earns it.** Clean up only when the resulting
   shape is genuinely better. Mechanical reshuffling is noise.

For bug fixes specifically: the failing test that reproduces the bug
is the most valuable artifact in the commit — it documents both the
bug and the contract that prevents its return. Do **not** write the
fix first and then add a test "to cover it"; the ordering matters.

**Exempt** (no TDD ceremony required): typo fixes, doc-only edits,
formatter / linter passes, dependency bumps, configuration-only
changes. Use judgement for refactors — extracting a helper rarely
needs a new test, but changing observable behavior does.

**UI features need a failing Playwright e2e first.** Any feature
that adds or changes a user-visible affordance (new button, new
filter, new card state, new modal, new view) starts with a RED
`frontend/tests/e2e/*.spec.ts` that drives the affordance through
a real browser via `page.route()` mocks. Unit tests in
`frontend/src/**/*.test.ts` cover render branches and composable
contracts, but only the e2e proves the full transport chain
(api.ts ↔ /api/* ↔ Go handler ↔ Store ↔ aggregator ↔ Vue render)
works as the user will experience it. "Stitching a known pattern
across layers" is NOT an exemption from RED-first — the match-
deletion feature shipped with a latent `r.json()`-on-204 bug in
`api.ts` because there was no e2e exercising the POST → reload
round-trip; the test that surfaced it should have driven the
implementation.

### REST API design

Apply when adding or changing any `/api/v1/...` route so the surface
stays predictable. `api/openapi.yaml` is the canonical wire
contract; this section explains the rules behind it. The
[Swagger UI](https://sound-barrier.github.io/recall/api/) renders
the spec for human readers.

**Versioning.** Every JSON endpoint sits under `/api/v1/`.
Breaking changes go to a new `/api/v2/` — never quietly mutate an
existing route's shape. Binary content (image bytes, file downloads
with non-JSON wire shapes) stays outside the JSON surface; current
example is `/_screenshot/{filename}`.

**Resources are nouns.** Plural for collections (`/matches`,
`/exports`, `/parses`); hierarchical for ownership
(`/matches/{matchKey}/annotation`, `/settings/tesseract`). Don't
put verbs in paths — what used to be `POST /api/clear-database`
became `DELETE /api/v1/matches`, and `GET /api/probe-screenshots-dir`
became `GET /api/v1/system/screenshots-folder-probe` (the "probe"
is the noun-form of the result). The "match keys are colon-bearing"
encoding rule applies whenever an identifier with `:` lands in a
URL path — see the Conventions bullet.

**Method-to-intent mapping**:

| Verb | Semantics | Example |
|---|---|---|
| `GET` | Read; safe + idempotent. | `GET /api/v1/matches` |
| `PUT` | Upsert / replace a resource; idempotent. | `PUT /api/v1/settings/watcher` |
| `DELETE` | Wipe a collection, or reset a setting to its platform default (the user-set override is the thing being deleted). | `DELETE /api/v1/matches`, `DELETE /api/v1/settings/tesseract` |
| `POST` | Trigger an action that doesn't map to a single resource. | `POST /api/v1/parses` |

Don't use `POST` for setters — `PUT` is the right verb when
replacing a field value. Model "reset to default" as `DELETE` on
the setting.

**Status codes**:

| Code | When |
|---|---|
| `200 OK` | GET with body, or write that echoes the new state (e.g. `GET`/`PUT`/`DELETE /api/v1/settings/tesseract` all return the re-detected status). |
| `202 Accepted` | Action whose meaningful effect is out-of-band — `POST /api/v1/parses` writes to SQLite + broadcasts SSE; HTTP body is irrelevant. |
| `204 No Content` | Write succeeded with no useful body (most setters, `PUT /matches/{key}/visibility`, `PUT /matches/{key}/annotation`, `DELETE /api/v1/matches`). |
| `400 Bad Request` | Client validation failure. Reach via a typed sentinel (`app.ErrInvalidScreenshotsDir`, `app.ErrInvalidLeaver`, `app.ErrInvalidTesseractPath`) and `errors.Is` in the handler so it stays out of the catch-all 500. |
| `405 Method Not Allowed` | Wrong method on a registered route. Handled automatically by `apiMux` — see the "Go ServeMux's no-method `/`" Conventions bullet for why a sub-mux is required. |
| `500 Internal Server Error` | Unexpected store / I/O failure. Anything reproducibly triggered by user input is 4xx, not 5xx. |

**Response shapes**:

- JSON for data; handlers emit `Content-Type: application/json`
  via `writeJSON`.
- Arrays use `make([]T, 0)` server-side, never `var x []T` — nil
  marshals to `null`, violates `type: array`, and trips
  schemathesis in CI.
- Errors are plain text via `http.Error`, descriptive enough to
  surface to the user. (Structured JSON errors are deferred until
  there's a real machine-parsing need on the client.)
- `204` / `202` carry no body; `_fetch` in `api.ts` resolves both
  to `undefined`.

**Request shapes**:

- JSON body for writes; `Content-Type: application/json`.
- Identity goes in the URL for hierarchical sub-resources
  (`/matches/{matchKey}/annotation` — the body carries only the
  annotation fields, not `match_key`).
- Query params for variants of the same operation
  (`/exports?format=json|csv`).

**Mux structure** (`pkg/cmd/server.go`):

API routes mount on `apiMux`, not the outer `mux`. Method-prefixed
Go 1.22 patterns (`apiMux.HandleFunc("PUT /api/v1/foo", ...)`)
give native 405 behavior because the sub-mux has no `/` catch-all
to swallow method-mismatched requests. The outer `mux` mounts
`apiMux` at `/api/v1/`, the `ScreenshotHandler` at `/_screenshot/`,
and the SPA `FileServer` at `/`.

**Adding or changing an endpoint** (3 steps):

1. Add / modify the method on `*app.App` in `pkg/app/*.go`. Use
   a typed sentinel for any user-input-driven error you want to
   surface as 4xx.
2. Edit `api/openapi.yaml` (pick verb + status code per the tables
   above) and mount the route on `apiMux` in `pkg/cmd/server.go`.
   `make gen-types` regenerates `frontend/src/api.gen.d.ts`; the
   lefthook pre-commit hook reruns it automatically so a stale
   types file can't slip into a commit.
3. Add the `api.ts` wrapper with BOTH the Wails-IPC delegation and
   the `fetch` path (use `_dualVoid` for void-returning writes;
   pass a path-builder function when the URL embeds an identifier).
   Skipping step (3) silently breaks server mode while Wails keeps
   working — there's no compile-time check.

**Generation + validation**:

| Command | Purpose |
|---|---|
| `make gen-types` | Regenerate `frontend/src/api.gen.d.ts` from the spec. Runs on every commit via lefthook; CI fails if the file is out of sync. |
| `make lint-openapi` | Spectral lint on `api/openapi.yaml` (`spectral:oas` + `.spectral.yaml`, `--fail-severity=warn`). Bundled into `make lint` and a pre-commit hook. |
| `make swagger` | Browse the spec locally — Swagger UI v5 in a container (`:8080` default; override via `SWAGGER_PORT`). |
| schemathesis (CI) | Fuzzes a built `recall-server` against the spec to catch shape drift between YAML and live responses. Runs in `ci.yml`. |

Public Swagger UI auto-deploys from `main` on every spec change to
<https://sound-barrier.github.io/recall/api/>.

### What to avoid

Speculative interfaces; abstract layers without a second concrete
caller; backwards-compat shims for unreleased code; "just in case"
error handling for impossible conditions; over-engineering for
hypothetical future requirements.

## Build, run, dev

Two binary flavors exist, selected by the `serveronly` Go build tag:

| Tag | Entry point | CGo | Description |
|---|---|---|---|
| *(default)* | `main.go` + `pkg/app/app_wails.go` | Yes | Full Wails desktop app |
| `serveronly` | `main_server.go` + `pkg/app/app_server.go` | No | Headless HTTP server (addr from `RECALL_SERVER_ADDR`, default `127.0.0.1:7000`) |
| *(none — both)* | `assets.go` | No | `//go:embed all:frontend/dist` — embedded FS shared by both variants |

| Command | Purpose |
|---|---|
| `make init` | Fresh-clone setup via `initialize.sh`: brew/apt deps, `go install` for tools not in Brewfile (Wails CLI, gofumpt, goimports-reviser, deadcode, govulncheck), Debian `webkit2gtk-4.0` → `4.1` pkg-config shims, `npm ci`, `lefthook install`, `direnv allow`. Idempotent. Needs Go 1.26+ / Node 22+ on PATH first. |
| `make dev` | Hot-reload dev server (macOS / Debian / Ubuntu). Vite `:5173`, Wails IPC `:34115`. Linux auto-passes `-tags webkit2_4_1` (Wails v2.12.0 CGo references 4.0; recent distros only ship 4.1). |
| `make build-linux` / `build-windows` | Wails app → `dist/<os>/Recall[.exe]` via Docker (mingw-w64 for Windows). |
| `make build-mac` | macOS Wails app → `dist/mac/Recall.app` (macOS host). Release workflow wraps it in a DMG; local target stops at `.app`. |
| `make build-all-docker` | Linux + Windows Wails apps — no macOS SDK needed. |
| `make build-server-{linux,windows,mac}` | Server binary → `dist/server-<os>/Recall-server` (`.exe` for Windows, `-arm64` suffix for mac) via Docker. |
| `make build-server-all` / `build-server-container` | All three server builds / Linux server container image with Tesseract → `recall-server:local`. |
| `make build-all` | All three Wails platforms (macOS host required). |
| `go build ./...` / `-tags serveronly ./...` | Compile-check Wails / server variant. |
| `bash -n scripts/X.sh` | Syntax-check a shell script. |
| `brew bundle` | Tesseract, Go toolchain, Podman, etc. from `Brewfile`. **Wails CLI separate**: `go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0`. |
| `direnv allow` | Activate `.envrc` (all env overrides documented + commented inside). |
| `cd frontend && npm ci` | Install frontend deps (required after clone / `make clean`). |
| `make fmt` | Go (`goimports-reviser` → `gofumpt`) + shell (`shfmt -w -i 2 -ci -bn`). Sub-targets: `fmt-go`, `fmt-shell`. |
| `make lint` | golangci-lint (both build tags), ESLint, Stylelint, HTMLHint, shellcheck + shfmt diff (`scripts/`, `.shellcheckrc`), Hadolint, yamllint, Spectral. |
| `make clean` | Remove `dist/`, `build/bin/`, `frontend/{dist,node_modules}`. |
| `make update-deps` | `go get -u ./...` + `go mod tidy` + `npm update`. Use `npx npm-check-updates -u` to also widen `package.json` ranges. |
| `make check-deps` | Compare pinned tools vs latest. Covers Wails CLI / hadolint / lefthook / trivy (from `postCreate.sh`) + Spectral / typos / gosec / Semgrep / Honkit (from `tool-versions.env`). Asserts the `crate-ci/typos@SHA  # vX.Y.Z` trailing comment in `ci.yml` matches `$TYPOS_VERSION`. Go/Node informational. |
| `make trivy` | Trivy scan (Go + npm + Dockerfile); fails on HIGH/CRITICAL. |
| `make cloc` / `cloc-detail` | LOC summary (`.clocrc` exclusions); detail adds per-file breakdown. |
| `make icon` | Resync `build/appicon.png` from `assets/icon.png` (1024×1024 via `sips`, macOS-only); clears `build/windows/icon.ico` so Wails regenerates `.icns`/`.ico` on next build. |
| `make swagger` | Swagger UI v5 in a container (default `:8080`, override `SWAGGER_PORT`). Public at <https://sound-barrier.github.io/recall/api/>. |
| `make pages-build` / `pages-preview` | Build docs book + Swagger UI under `dist/pages/` (mirrors `pages.yml` staging); preview adds `python3 -m http.server` on `$(PAGES_PORT)` (default `:4000`). Honkit pin: `HONKIT_VERSION`. |
| `make lint-openapi` | Spectral (`spectral:oas` + `.spectral.yaml`, `--fail-severity=warn`). Also in `make lint`. |
| `make test` | Go unit (`-race`; `pkg/{app,db,parser}/*_test.go`) + Vitest. Parser golden-file tests scan repo-root `testdata/` — override with `RECALL_FIXTURE_DIR` (absolute path). CI uses `-short` to skip the golden test. |
| `make cover` / `cover-go` / `cover-frontend` | Coverage reports → `coverage/go/` + `frontend/coverage/` (gitignored). Go fails below `GO_COVERAGE_MIN` (default 46%); frontend fails below `coverage.thresholds` in `vitest.config.ts` (70/70/60/55). |
| `make test-e2e` | Playwright (`frontend/tests/e2e/*.spec.ts`). Builds frontend + `serveronly` binary into `/tmp/recall-e2e/recall-server`, installs Chromium, runs with `HOME=/tmp/recall-e2e` on `127.0.0.1:7099`. Required for any UI feature (TDD rule). |
| `make test-all` | `make test` + `make test-e2e`. |
| `make gen-types` | Regenerate `frontend/src/api.gen.d.ts` from `api/openapi.yaml`. Run after every spec edit; CI fails if out of sync. |
| `make typecheck` | `vue-tsc --noEmit` — `.ts` files + `<script lang="ts">` blocks. `allowJs: false` blocks JS introduction. |

**Package layout (`pkg/`)**:

| Package | Contents |
|---|---|
| `pkg/app` | `App` struct + file-per-concern under `pkg/app/*.go` — settings, tesseract, watcher, metrics lifecycle, update, screenshots dir, screenshot handler, inference, match record, parse, aggregate, correlation, export (json + csv), owdata, probe, sse. Production / test files are 1:1 siblings (`watcher.go` ↔ `watch_events_test.go`). Build-tag pair `app_wails.go` / `app_server.go` for dialog methods + event-emit shims. `ls pkg/app/*.go` is the source of truth — don't maintain a literal list here. |
| `pkg/cmd` | `RunWails` (Wails init) and `RunServer` (HTTP server + REST API) |
| `pkg/db` | SQLite `Init()` + `DB` variable |
| `pkg/metrics` | Prometheus `Collector` + `Server` |
| `pkg/parser` | OCR pipeline split per concern. `parser.go` (dispatcher + `ParseScreenshotsDir`), `classify.go` (screenshot-type detection), `types.go`, `heroes.go` / `maps.go` / `owdata.go` (YAML-backed roster + map tables, embedded at compile time), `tesseract.go`, `imageutil.go`, `text.go`, four `parse_*.go` files per screenshot type, `exec_{other,windows}.go` HideWindow build-tag pair, `golden.go` for integration-test fixture helpers. `ls pkg/parser/*.go` is the source of truth. |

`.devcontainer/devcontainer.json` + `postCreate.sh` mirror the Brewfile
on a Debian + Docker-in-Docker base so the project can be developed
inside VS Code Dev Containers or GitHub Codespaces with zero host
install. The Wails GUI can't render inside the container (no display
surface); contributors there use `go run -tags serveronly . --server`
and access port 7000 via the forwarded host port. For a native window,
the supported dev hosts are **macOS** and **Debian/Ubuntu** (both run
`make dev`); Windows is supported as a release target only and dev
work happens inside WSL2 Ubuntu via the Debian path. `make icon` is
macOS-only (uses `sips`) and skips elsewhere.

`Dockerfile.build` has 14 named stages. Stages 1–6 are the Wails builds (need CGo + WebView libs). Stages 7–13 are the `serveronly` builds — pure Go, `CGO_ENABLED=0`, cross-compiled on Linux for all three OS targets including a macOS arm64 variant. The server stages inherit from `go-base` (module deps already downloaded) and need no apt packages. Stage 14 (`server-container`) is a `debian:bookworm-slim` runtime image with Tesseract pre-installed, used for Docker deployments.

**Environment variable overrides** (all optional, mainly for debugging):

| Var | Default | Effect |
|---|---|---|
| `RECALL_DATA_DIR` | platform user-config dir | Root directory for `settings.json` + `db/recall.db`. The repo's `.envrc` sets this to `$PWD/data` so `wails dev` (and `go run`) keep their state under the repo for inspection. Released app launches don't load `.envrc`, so the platform path applies. `scripts/_db.sh::recall_db_path` honors the same env var so the `db-*.sh` scripts see the same DB. |
| `RECALL_DEBUG_DIR` | system temp | Directory for Tesseract work files; set to a fixed path to inspect them after a parse run. |
| `OWMETRICS_DEBUG_DIR` | *(off)* | When non-empty, dumps raw Tesseract output `.txt` files into the work dir for each OCR call. |
| `OWMETRICS_METRICS_ADDR` | `:9091` | Override Prometheus metrics bind address (e.g. `OWMETRICS_METRICS_ADDR=:9292 wails dev`). |
| `RECALL_SERVER_ADDR` | `127.0.0.1:7000` | Override the HTTP server bind address. Set to `0.0.0.0:7000` when running inside Docker so the port is reachable from the host. |
| `DOCKER` | `docker` | Container runtime binary for `make build-*` targets. Set to `podman` when using Podman. |
| `RECALL_PPROF` | *(off)* | When set to anything truthy (`1`, `true`, any non-empty non-`0/false` value), mounts `net/http/pprof` handlers under `/debug/pprof/` in server mode. Off by default — never expose pprof publicly. |
| `RECALL_FIXTURE_DIR` | `../../testdata` (resolved from `pkg/parser/`) | Directory of `.png` fixture screenshots for `TestParseScreenshot_GoldenFiles`. Each `foo.png` needs a sidecar `foo.png.golden.json`. Default points at the repo-root `testdata/`. Override with an ABSOLUTE path — `RECALL_FIXTURE_DIR=testdata` would resolve relative to the test binary's cwd (`pkg/parser/`) and miss the dir. Use `make update-goldens` (or set `RECALL_FIXTURE_UPDATE=1` directly) to regenerate goldens after a parser change. |

Go unit tests live in `pkg/app/`, `pkg/db/`, and `pkg/parser/` —
covering merge orchestration, store integration, boundary path
validators, screenshot-type detection, OCR text helpers, and the
platform-tagged `HideWindow` shims. Full-image parser tests live
in `pkg/parser/integration_test.go` and default to scanning the
repo-root `testdata/` dir (resolved as `../../testdata` from the
package's cwd). The committed fixture set there covers the
post-match SUMMARY / TEAMS scoreboard / PERSONAL paths across
two real matches; see `testdata/README.md` for the coverage
checklist (rank screens and in-game scoreboard slots remain
unchecked, contributions welcome). To curate from your own
captures, drop PNG files into a private dir and run
`make update-goldens RECALL_FIXTURE_DIR="$PWD/yourdir"` to seed
the `.golden.json` sidecars (absolute path required — the test
binary's cwd is `pkg/parser/`, so a relative override would
resolve from there); the test then asserts against them on every
`make test` run. For
quick local exploration outside the test runner, a throwaway
`x*_test.go` in `pkg/app/` that imports `recall/pkg/app` directly and
calls `app.Startup` + `app.ParseScreenshots` still works — delete the
file when done so it doesn't accumulate.

## Pipeline

```text
screenshots/*.png
      │
      ▼  (Tesseract via parser.ParseScreenshot, dispatched per screenshot type)
parser.MatchResult
      │
      ▼  (pkg/app/parse.go: screenshotType + resolveMatchKey, then per-type Upsert)
SQLite per-type tables:
   summary_screenshots    + summary_heroes_played
   scoreboard_screenshots + scoreboard_hero_stats
   personal_screenshots   + personal_hero_stats
   rank_screenshots       + rank_modifiers + rank_sr
   unknown_screenshots                                  ← source of truth (1 row per screenshot)
      │
      │  (read time: pkg/app/aggregate.go::aggregateAll bulk-loads,
      │   groups by match_key, folds via mergeMatchResult)
      ▼
   MatchRecord
      │
      ├──→ Wails GetMatchResults() ──→ Vue UI (App.vue)
      └──→ metrics.Collector reads on every Prometheus scrape ──→ Grafana
```

**SQLite is the source of truth.** The raw per-screenshot rows are preserved verbatim — aggregation (folding multiple screenshots into one match) happens at read time, so a wrong scalar from one screenshot can be corrected later by adding another screenshot to the match. The Prometheus collector reads via the same aggregator on every scrape; filters (e.g. competitive-only) live at the metrics boundary in `pkg/metrics/metrics.go::Collect`, **not** in the parser or DB — so quickplay matches are visible in the Wails UI but never reach Grafana.

### Schema (3NF, 10 tables)

Five **parent** tables (one per screenshot type) plus five **child** tables for the repeating-group fields:

| Parent | Children |
|---|---|
| `summary_screenshots` (scalar SUMMARY fields + 6 inlined `perf_*` columns) | `summary_heroes_played` (hero, percent_played, play_time) |
| `scoreboard_screenshots` (E/A/D + damage/healing/mit + map/mode/hero) | `scoreboard_hero_stats` (hero, stat_key, stat_value) |
| `personal_screenshots` (hero only) | `personal_hero_stats` (hero, stat_key, stat_value) |
| `rank_screenshots` (rank/level/progress/change/result) | `rank_modifiers` (modifier), `rank_sr` (hero, sr, change) |
| `unknown_screenshots` (no domain fields) | *(none)* |

Each parent has `id INTEGER PK AUTOINCREMENT`, `filename TEXT UNIQUE`, `match_key TEXT NOT NULL`, and `parsed_at DATETIME DEFAULT CURRENT_TIMESTAMP`. Children reference their parent with `ON DELETE CASCADE` and have a composite PK that prevents duplicate fold-ins on re-parse. **`NewSQLStore` must `PRAGMA foreign_keys = ON`** — SQLite parses the CASCADE rules but only enforces them when this pragma is set on every connection.

**Derived fields are not stored.** `role` is computed from `hero` via `parser.HeroRole`, `type` from `map` via `parser.MapType`; both lookups hit the YAML-derived in-memory tables (`pkg/parser/heroes.yaml`, `pkg/parser/maps.yaml`). Storing them would be a 3NF violation (transitive dependency) and would surface as "row A says juno=support but row B says juno=dps" inconsistencies after a YAML change.

### Write path (per screenshot, inside one `BEGIN…COMMIT`)

1. `screenshotType()` classifies the parse result and dispatches to one of `UpsertSummary` / `UpsertScoreboard` / `UpsertPersonal` / `UpsertRank` / `UpsertUnknown`.
2. **`resolveMatchKey()`** scans every parent table for an existing screenshot to adopt the key from:
   - **EAD-signature match** — any existing scoreboard with the same non-zero `(eliminations, assists, deaths)` and no `(map, hero)` conflict. Bridges in-game scoreboard ↔ post-match summary.
   - **Timestamp-window match** — any existing screenshot within `mergeWindow` (2 min) with no signature conflict. Closest-in-time wins — handles a PERSONAL screenshot landing between two adjacent SUMMARY windows.
   - **Fresh key** — `match:<earliest-filename-ts>`, or `unmatched:<filename>` for files without a parseable timestamp.
3. Parent UPSERT via `ON CONFLICT(filename) DO UPDATE SET … RETURNING id` — `parsed_at` is intentionally **not** in the SET clause so the first-insert timestamp survives re-parses.
4. `DELETE FROM <child> WHERE <parent>_id = ?` to wipe stale children, then `INSERT INTO <child> …` for every new child row.

The DELETE-then-INSERT (instead of UPSERT) for children is deliberate: each child PK is a composite `(parent_id, hero[, stat_key])`, and a re-parse that drops a hero from `HeroesPlayed` must wipe that hero's old row — UPSERT alone wouldn't remove it. Idempotent: re-clicking Parse replaces rows in place, no duplicates.

### Read path (`pkg/app/aggregate.go::aggregateAll`)

One bulk SELECT per parent + one per child table — every table is hit exactly once per call (called from `GetMatchResults` and on every Prometheus scrape, so no N+1 risk). Child rows attach to parents by id, parents re-key by `match_key`, each group sorts by `(filename-timestamp asc, parsed_at asc)`, and `mergeMatchResult` folds via "first non-empty wins". `role` and `type` are resolved on the fly via `parser.HeroRole` / `parser.MapType`, never stored.

### DB location + identity

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Recall/db/recall.db` |
| Linux | `~/.config/recall/db/recall.db` (or `$XDG_CONFIG_HOME/recall/db/`) |
| Windows | `%AppData%\Recall\db\recall.db` |

Resolved by `appDataDir()` in `pkg/app/settings.go`. Match identity is `match_key` (string) — **no integer `id`** on the API surface. Per-source-file screenshot type is the parent table the row lives in (no separate `source_types` column); `MatchRecord.SourceTypes` is built at aggregate time from each row's parent table name.

### Adding a field

- **New parser scalar** → `ALTER TABLE … ADD COLUMN` in `schemaStatements` (idempotent — "duplicate column" errors tolerated), add the field to the matching `*Row` struct in `pkg/db/store.go`, add it to the Upsert SET clause.
- **New repeating-group dimension** → new child table referencing the right parent with `ON DELETE CASCADE`.

## Per-screenshot-type parsers (`pkg/parser/`)

`ParseScreenshot` in `parser.go` dispatches by detector probes; each
probe + parser pair lives in its own file (`parse_rank.go`,
`parse_summary.go`, `parse_personal.go`, `parse_scoreboard.go`):

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
  fails to read PNG files at `/tmp/...` paths but works at `/private/tmp/...`.
  Affects debug runs only — production uses `os.MkdirTemp`.

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

`metrics.NewServer(addr, reader)` builds but **doesn't bind**. `Start()` listens in a goroutine; `Stop()` does a 2s graceful shutdown. `http.Server` can't be reused after `Shutdown`, so each enable→disable→enable cycle constructs a fresh `Server`.

## App shell (`pkg/app/`)

`App` owns:

- `settings` (`<appDataDir>/settings.json`): screenshots dir, tesseract path, prometheus/watch enabled. Each toggle persists on change. `appDataDir()`: `~/Library/Application Support/Recall/` (macOS), `~/.config/recall/` (Linux), `%AppData%\Recall\` (Windows).
- `metricsServer` (nil unless Prometheus toggle on).
- File watcher (`watcher`, `watchedDir`, `watchTimer`, `watchMu`) with `watchDebounce = 60*time.Second`: any new `.png`/`.jpg` resets a timer; expiry runs `ParseScreenshots` + `emitParseComplete()`.
- `parseMu` serializes `ParseScreenshots` (manual click + watcher can't race).
- `SSEHub *SSEHub` — non-nil in server mode; broadcasts `parse-complete` to connected browser tabs.

**File layout**: `ls pkg/app/*.go` — file-per-concern (`tesseract.go`, `watcher.go`, `correlation.go`, `aggregate.go`, …); production + test files are 1:1 (`watcher.go` ↔ `watch_events_test.go`). Build-tag pairs: `app_wails.go` / `app_server.go` (dialog + event-emit shims), `pkg/parser/exec_other.go` / `exec_windows.go` (`HideWindow` shim).

**Wails-bound methods**: every exported `*app.App` method is auto-bound — `grep -rE '^func \(a \*App\) [A-Z]' pkg/app/*.go` lists the surface. Same methods exposed under `/api/v1/...` via `pkg/cmd/server.go` (resource layout in `api/openapi.yaml`). `api/openapi.yaml` is the contract for both transports; `make gen-types` regenerates `api.gen.d.ts`.

**Constructor**: `app.New()` in `pkg/app`.

**HTTP server mode** (`pkg/cmd/server.go::RunServer(a, assets)`): fires when `-s`/`--server` is passed to the Wails binary, or always when compiled `serveronly`. Listens on `RECALL_SERVER_ADDR` (default `127.0.0.1:7000`), serves the embedded SPA, exposes every App method under `/api/v1/` (versioned prefix; methods are GET to read, PUT to upsert/replace, DELETE to clear/reset, POST to trigger an action — see `api/openapi.yaml`), streams `parse-complete` via `GET /api/v1/events` (SSE). API routes live on a dedicated `apiMux` sub-mux so the `/` SPA fallback doesn't swallow method-mismatched requests — the sub-mux returns 405 for wrong methods. `PickScreenshotsDir` / `PickTesseractBinary` (native dialogs) are replaced by `PUT /api/v1/settings/screenshots-folder` + `PUT /api/v1/settings/tesseract`; `api.ts` falls back to `window.prompt()`.

**OpenAPI** (`api/openapi.yaml`, 3.1.0, hand-written) is the source of truth for the HTTP surface. Edit when adding/removing a route or changing a response shape. `make lint-openapi` runs Spectral `--fail-severity=warn` (most spectral:oas issues are warnings). `make swagger` browses it locally.

**Wails-bound handler**: `ScreenshotHandler()` serves `/_screenshot/<filename>` from the configured screenshots dir — used by both Wails `AssetServer.Handler` and the server-mode mux.

## Frontend

Lives in `frontend/`. Auto-discovered nested `frontend/CLAUDE.md` carries
the Vue/CSS/composables/a11y/Vitest/Playwright/bundle-budget context.
Cross-boundary concerns (the `api.ts` / `/api/*` contract, build wiring,
`//go:embed all:frontend/dist`) stay in this file's Conventions section.

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

Nine workflows:

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push or PR to `main` | **Lint** (golangci-lint × both tags, ESLint, Stylelint, HTMLHint, Hadolint, yamllint, Spectral) → **frontend build** → **bundle-size budget** (initial JS<130KB / initial CSS<80KB / total JS<250KB / total CSS<120KB) → **Go + Vitest** → **`vue-tsc --noEmit`** → **`api.gen.d.ts` in sync** check. Parallel: Linux/Windows/macOS Wails + all server binaries + container image. **Security**: Trivy (SARIF → Security tab), govulncheck (both tags), gosec (both tags via `go install ...@${GOSEC_VERSION}` against setup-go's Go — NOT `securego/gosec` action which bundles stale Go). JS/TS SAST is covered by CodeQL's `javascript-typescript` language (see `codeql.yml`); Semgrep runs only locally via `make lint-semgrep` + the pre-push lefthook hook. **Dead-code**: deadcode (`serveronly` only — Wails methods are reflection-called) + knip (TS exports + devDeps). **Coverage**: coverage-go (fails < `GO_COVERAGE_MIN`=46%; cobertura artifact) + coverage-frontend (Vitest V8 against `coverage.thresholds`: 70/70/60/55). **PR comments**: lint job posts sticky "Unit test results" via `EnricoMi/publish-unit-test-result-action`; `coverage-comment` posts sticky `coverage` via `irongut/CodeCoverageSummary` + `marocchino/sticky-pull-request-comment` (`fail_below_min:false` — real gate is upstream). **Drift**: schemathesis fuzzes a built server against `api/openapi.yaml`. |
| `codeql.yml` | Push or PR to `main` + weekly cron | GitHub CodeQL static analysis. Matrix covers `go`, `javascript-typescript`, and `actions` (the last parses `.github/workflows/*.yml` + composite actions for script-injection sinks, missing `persist-credentials`, untrusted-input → env flows, etc.). Runs the **`security-and-quality`** query suite — bundles core security queries (`code-scanning`), extended security including hardcoded-credentials / weak-crypto / extra taint sinks (`security-extended`), and code-quality queries (dead code, redundant logic, complexity smells). Higher false-positive rate than the default — triage every Security-tab alert. Languages without a security-and-quality pack (currently `actions`) silently fall back. Provides JS/TS SAST coverage so no separate Semgrep CI job is needed — Semgrep runs only locally via lefthook. |
| `dependency-review.yml` | PR to `main` | Blocks PRs introducing dependencies with vulnerabilities or disallowed licenses (uses `actions/dependency-review-action`). |
| `pr-compliance.yml` | PR to `main` (`opened`/`edited`/`synchronize`/`reopened`) | Grep-checks PR body for two ticked checkboxes: CoC + Apache-2.0. Fails with `::error::` if missing; re-runs on `edited` so contributors can tick without pushing. Exempts `dependabot[bot]`, `github-actions[bot]`, AND any branch starting with `release-please--` (release-please uses the maintainer's PAT → human author login, so branch-name prefix is the reliable signal). Body read via `PR_BODY` env var (script-injection-safe), never `${{ }}`-interpolated. |
| `e2e.yml` | Push/PR to `main` (paths: `frontend/**`, `pkg/**`, `**/*.go`, `api/openapi.yaml`, `e2e.yml`) | Playwright E2E. Builds frontend + serveronly binary, `npx playwright install --with-deps chromium`, runs `frontend/tests/e2e/*.spec.ts`. `webServer` boots `/tmp/recall-e2e/recall-server` on `127.0.0.1:7099` with `HOME=/tmp/recall-e2e` (hermetic). Separate from `ci.yml` so lint/unit stay fast when frontend untouched. Uploads `frontend/playwright-report/` on failure (7-day artifact). |
| `labels.yml` | Push to `main` (`.github/labels.yml` + `labels.yml` paths) + `workflow_dispatch` | Syncs repo labels to `.github/labels.yml` via `EndBug/label-sync@v2`. `delete-other-labels: false` by default (manual UI labels survive); dispatch input flips it `true` for cleanup. |
| `pages.yml` | Push to `main` (paths: `api/openapi.yaml`, `docs/**`, `book/**`, `testdata/**`, `pages.yml`) + `workflow_dispatch` | Builds (1) Honkit user-docs book from `book/` + 11 `docs/*.md` chapters + `testdata/` mirror (for README-shared image paths) → Pages root; (2) Swagger UI of `api/openapi.yaml` → `/api/`. New chapter: update `book/SUMMARY.md` + the `cp` step in `pages.yml` + the `pages-build` Makefile target. Honkit pin: `HONKIT_VERSION`. **One-time setup**: Settings → Pages → Source = "GitHub Actions" (workflow can't flip; missing it surfaces as `Get Pages site failed`). |
| `release-please.yml` | Push to `main` | Reads Conventional Commits since last tag, opens/updates Release PR bumping `.release-please-manifest.json` + `CHANGELOG.md`. Merging creates `vX.Y.Z` tag → fires `release.yml`. Override version with `Release-As: X.Y.Z[-suffix]` footer (hyphenated suffix = GitHub flags as prerelease). Shortcut: `make release-beta VERSION=…`. **Identity**: uses a PAT not `GITHUB_TOKEN`, so PR is authored under maintainer's account → `pull_request` workflows DO trigger AND bot-login-based exemptions need a branch-name fallback (`startsWith(head.ref, 'release-please--')`). |
| `release.yml` | `v*` tags | Builds and publishes release artifacts. Per-job breakdown, GHCR tag matrix, cosign signing details, and the `workflow_dispatch` fallback recipe live in [RELEASES.md](RELEASES.md) → "`release.yml` jobs". |

## Documentation audiences

| File(s) | Audience | Notes |
|---|---|---|
| `README.md`, `docs/install-{macos,linux,windows}.md` | Gamers | Quick start + per-platform install. Keep jargon out of these. |
| `docs/how-it-works.md` | Gamers | Pipeline overview + expected user workflow + the four screenshot types. Anchors the book's "Using Recall" section. |
| `docs/settings-reference.md` | Gamers | Every Settings + Parse tab field documented. Source of truth for "what does this knob do?". |
| `docs/filtering.md` | Gamers | Matches tab filter rail end-to-end. |
| `docs/unknown-screenshots.md` | Gamers | Unknown tab triage: 4 common causes + diagnostic strip + recovery paths. |
| `docs/feedback.md` | Gamers | Bug/feature request pointer to `.github/ISSUE_TEMPLATE/*.yml` + security-advisory channel. |
| `docs/server.md`, `docs/docker.md`, `docs/grafana.md` | IT-savvy users | README's "Advanced" gates entry. |
| `CONTRIBUTING.md`, `RELEASES.md` | Developers | Build, lint, release, commit-message rules. |
| `CODE_OF_CONDUCT.md` | Repo participants | Two rules: be respectful, project is free with no SLAs. ~50 lines, not the Contributor Covenant. |
| `SECURITY.md` | Security reporters | Latest-release-only support; file via GitHub Security Advisories (private), no SLA. Scope enumerates in/out-of-scope. CoC's "Reporting violations" cross-refs. |
| `.github/ISSUE_TEMPLATE/*.yml` + `pull_request_template.md` | Issue/PR authors | YAML Issue Forms: `bug_report` (QA-style) + `feature_request` (what/why/how/alternatives), labelled via `.github/labels.yml`. `config.yml` disables blank issues. PR template carries the commit-style + TDD + docs checklist + two enforced attestations (CoC, Apache-2.0) — `pr-compliance.yml` grep-checks them, so edit template wording AND grep regex together. |
| `.github/CODEOWNERS` | PR routing | Catch-all `* @jacob-delgado` auto-requests a review. Last-matching-rule-wins if you add more specific patterns above. |
| `.github/labels.yml` | Triagers | Declarative label defs. Three groups: Conventional Commits types (mirrors commit-msg hook), triage standard, project-specific. Synced by `labels.yml` workflow. |
| `CLAUDE.md` | AI assistants | This file — AI assistant context. Not user-facing. |

Cross-doc anchors that are load-bearing: `docs/install-{macos,linux,windows}.md#verifying-your-download` (linked from README's Verifying section), `CONTRIBUTING.md#building` (linked from `install-linux.md`), `CONTRIBUTING.md#pre-commit-hooks-lefthook` (linked from README and RELEASES). Rename a heading and you'll silently break the inbound link.

## Conventions worth knowing

- **Fixing CI on a remote-authored PR (Ultraplan / Claude Code on the web).** Those sessions skip lefthook, so commits routinely fail `gofumpt` / `goimports-reviser` / `golangci-lint` / `typos` / `conventional`. Pattern:
  - `lint` failure → checkout the branch, fix with `make lint-go` + `typos .`, commit `style:`/`docs:`, push.
  - `pr-report` failure is downstream of `lint` (downloads its artifact); clears when lint goes green.
  - `required-checkboxes` failure → bot left attestation boxes unticked. `gh pr view N --json body --jq .body > /tmp/body.md`, flip the two `- [ ]` lines to `- [x]`, `gh pr edit N --body-file /tmp/body.md`. Body comes back CRLF — use Python `replace()`, not BSD sed.
  - `typos` flags identifier+plural-s runs (pluralising an all-caps word by appending `s` splits as `<word>` + `Ys`/`Ts`). Rephrase ("SUMMARY screens") rather than extending `_typos.toml`.

- **Iterating a Playwright e2e spec locally** — `reuseExistingServer: !process.env.CI` keeps `recall-server` running across `npx playwright test` runs, but the binary embeds `frontend/dist` at build time. After any `frontend/src/**` or `pkg/**` change, rebuild + kill before retesting: `cd frontend && npm run build && cd .. && go build -tags serveronly -o /tmp/recall-e2e/recall-server . && lsof -i :7099 | awk 'NR==2 {print $2}' | xargs -r kill`. Symptom of stale server: locator counts stay at pre-change values for 14 polling retries despite `page.route()` mocks being correct. `make test-e2e` rebuilds for you.

- **`_fetch` in `api.ts` returns `undefined` for HTTP 204 / 202.** `r.json()` on a no-body response throws `SyntaxError: Unexpected end of JSON input` — silently broke every 204 writer (`SetMatchVisibility` / `SetMatchAnnotation` / `SetLeaverAnnotation`) in server mode until the e2e caught it. New 204/202 endpoints need `.then(() => undefined)`; `_fetch` handles the empty body.

- **Go ServeMux's no-method `/` SPA fallback eats method-mismatched API requests.** With method-prefixed patterns (`POST /api/v1/parses`) plus a `/` FileServer on the same mux, a `GET /api/v1/parses` fully matches `/` (matches every method) and routes to the FileServer (404) instead of returning 405. Keep `/api/v1/` on a dedicated `apiMux` sub-mux mounted via `mux.Handle("/api/v1/", apiMux)` — the sub-mux has no catch-all, so method mismatches inside it return 405. Pattern in `pkg/cmd/server.go::NewMux`; new routes go on `apiMux`, not the outer `mux`.

- **Match keys are colon-bearing — URL paths need `encodeURIComponent`.** `match_key` is `match:<ISO-timestamp>` or `unmatched:<filename>`. Embedding raw in a URL splits at the colon in many parsers (`/api/v1/matches/match:2026-05-10T22:21:11/annotation`). `api.ts` route builders pass the key through `encodeURIComponent`; Playwright `page.route()` globs (e.g. `match-deletion.spec.ts`) must use the encoded form too. Server-side `r.PathValue("matchKey")` returns the already-decoded value, so handlers use it directly.

- **`MatchRecord.Hidden` is a UI filter, not a metrics filter.** Aggregator tags it for the FilterRail; `scrapeReader` in `pkg/app/inference.go` does NOT skip on `Hidden` — Grafana trends see every competitive match including hidden ones. Metrics-layer filter stays `Mode != "competitive"` only. Pinned by `TestApp_ScrapeReader_StillEmitsHiddenMatches`. If we ever filter hidden from Prometheus too, do it in `scrapeReader` (one decision point).

- **Vue `<style scoped>` miscompiles `:global(X) .y { … }` partial form.** The compiler strips `.y` and emits a bare `X { … }` rule — e.g. `:global([data-theme="light"]) .link-btn { color: ... }` becomes `[data-theme="light"] { color: ... }` matching `<html>` directly. If the body sets `opacity`/`background`/anything beating `style.css`'s `html[data-theme="light"]` specificity (0,0,1,1), the SFC pollutes the whole page once mounted (scoped tags persist in `<head>` after unmount). Put cross-theme overrides in `app.css` scoped under a parent id (`[data-theme="light"] #panel-settings .x`), not `<style scoped>`. Verify: `cd frontend && npm run build && grep -c "^\[data-theme=light\]{" dist/assets/*.css` must stay 0. Latent in `MatchCard.vue` / `ParseProgressPanel.vue` / `ParseStatusBar.vue` but harmless (color/background only).

- **sqlclosecheck + per-iteration `*sql.Rows` close.** When a loop opens a fresh `s.db.Query(...)` on every iteration with multiple exit paths, extract the per-iteration body into a helper so a single `defer rows.Close()` covers every return — open-coding `_ = rows.Close()` at each exit will be flagged. Pattern: `SQLStore.collectFilenames` in `pkg/db/store.go`.

- **`frontend/node_modules/` doesn't pollute `go list ./...`** — `flatted` ships a stray `golang/pkg/flatted/flatted.go` that Go's walker would absorb. `frontend/scripts/seed-go-sentinel.cjs` (npm `postinstall`) drops a stub `frontend/node_modules/go.mod` so the walker stops there; `frontend/dist` stays in the recall module for `//go:embed`. Belt-and-suspenders: `scripts/deadcode-check.sh` filters `node_modules`, `make lint-gosec` passes `-exclude-dir=frontend`. New whole-program Go tools should keep the filter.

- **`Dockerfile.build` frontend-builder runs `npm ci` BEFORE copying full `frontend/` source** — only `package.json`, `package-lock.json`, and `frontend/scripts/seed-go-sentinel.cjs` are in the layer. The sentinel is required because `package.json`'s `postinstall` invokes it; without the explicit `COPY frontend/scripts/seed-go-sentinel.cjs ./scripts/...` line, npm ci dies and every Docker build breaks. Any new postinstall hook referencing a project file needs the same up-front COPY.

- **Multi-line code in CLAUDE.md bullets trips markdownlint MD031.** A fenced block indented under `-` violates "fenced code blocks should be surrounded by blank lines"; adding blanks breaks the bullet continuation. Inline as a single backtick string instead — long lines are fine, no line-length rule in this repo.

- **Headings with em-dashes / non-ASCII trip markdownlint MD051.** Honkit's slugifier preserves the dash; MD051's validator strips it, so in-doc `[label](#fragment)` links break. Reference sections by name ("see section 3 below") instead of fragment-linking.

- **CI jobs in `ci.yml` use sequential numbered comments** (`# ── Job N: ...`). When inserting a new job between existing ones, renumber subsequent comments to keep the sequence contiguous.

- **`deadcode` always exits 0** — findings are printed to stdout but the exit code is never non-zero. To gate on findings in a Makefile or CI step, capture stdout and assert it's empty (or grep-filter expected stubs). See `make dead-code-go` for the pattern.

- **`TECHNICAL_DEBT.md` is delete-when-paid, not strikethrough-when-paid.** Header says "delete the section — git history is the audit trail." No `Phase N ✅ COMPLETE` subsections, no `~~item~~` lines — delete closed items. Item numbers stay stable (gaps fine; never renumber).

- **Pre-push hook runs `make cover`** — every `git push` reproduces Go + Vitest coverage (~3-5s). Gates on `GO_COVERAGE_MIN` + `vitest.config.ts` `coverage.thresholds`. Skip with `LEFTHOOK_EXCLUDE=coverage git push ...` only if you trust CI to catch it.

- **deadcode allow-list is `scripts/deadcode-allow.txt`.** `Makefile` `dead-code-go`, `lefthook.yml` `pre-push.deadcode`, and `ci.yml` "Dead Go code" all shell out to `scripts/deadcode-check.sh` which reads one regex per line from the allow-list and fails on non-empty residual. New intentional unreachable: append a line to the allow-list, don't touch the three callers.

- **Pinned tool versions live in `tool-versions.env`.** Keys: `SPECTRAL_VERSION`, `TYPOS_VERSION`, `GOSEC_VERSION`, `SEMGREP_VERSION`, `HONKIT_VERSION`, `TESSERACT_VERSION` (informational major.minor — mismatch = re-baseline `testdata/*.golden.json` and bump). Consumers:
  - `Makefile` — `include tool-versions.env`
  - `lefthook.yml` — `. ./tool-versions.env`
  - `ci.yml` + `pages.yml` — `grep -E '^[A-Z_][A-Z0-9_]*=' tool-versions.env >> "$GITHUB_ENV"` (grep filter required — Actions' env validator rejects comments)
  - `initialize.sh` + `.devcontainer/postCreate.sh` — `. tool-versions.env`

  `make check-deps` validates all four upstream + the `crate-ci/typos@SHA  # vX.Y.Z` comment in `ci.yml`. Wails CLI / hadolint / lefthook / trivy still duplicated between `initialize.sh` and `postCreate.sh`; `make check-deps` parses both. **Swagger UI image** (`SWAGGER_IMAGE`) is the only unchecked pin.

- **`typos --force-exclude` required when filenames are passed explicitly.** `_typos.toml`'s `extend-exclude` only applies during dir walks. Lefthook passes `{staged_files}` as positional args → bypasses extend-exclude unless `--force-exclude` is set. Keep the flag whenever handing typos explicit paths (else binary `testdata/*.png` get scanned as text).

- **Third-party GitHub Actions are SHA-pinned with a `# vX.Y.Z` comment** — `scripts/check-action-pins.sh` enforces from `make lint-actions`, lefthook `pre-push.actionlint`, and CI. Tag-pinned refs rejected. Pattern: `uses: actions/checkout@<sha>  # v4` (two spaces before `#` for yamllint). First-party composite (`./.github/actions/foo`) exempt. Dependabot bumps both fields. Resolve a SHA: `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`.

- **`httptest.NewRequest` + `NewRecorder` is the HTTP-handler test pattern.** Used by `pkg/cmd/server_test.go` (mux via `get` / `put` / `del` / `fire` helpers — `fire` is the generic-method primitive the others wrap), `pkg/metrics/metrics_test.go`, `pkg/app/screenshot_handler_test.go`. For App handlers, mutate `a.settings.X` directly (not via `SetX`, which writes to real `settings.json`). **Gotcha**: `httptest.NewRequest` panics on malformed escapes (`%ZZ`). To test `url.PathUnescape` branches, build a valid request then mutate `req.URL.Path` directly — that skips re-validation. See `TestScreenshotHandler_RejectsMalformedURLEscape`.

- **Outbound HTTP uses a `var url = "..."` seam, not an injected `*http.Client`.** `pkg/app/update.go` exposes `releasesURL` as a package var so `check_for_update_test.go` can swap to `httptest.NewServer` URL. Same pattern works for any package-level test mutation (`withVersion(t, "0.1.0-dev")` swaps the ldflags-injected `Version`). Recipe: `prev := X; X = newVal; t.Cleanup(func() { X = prev })`.

- **`docs/` is the source of truth for doc chapters; `book/` is metadata only.** Honkit-built site at <https://sound-barrier.github.io/recall/> renders `docs/install-{macos,linux}.md`, `docs/{server,docker,grafana}.md`, etc. The Pages workflow + `make pages-build` stage `book/` + chapter copies into `_stage/book/` (CI) or `dist/pages-stage/` (local) and run Honkit there. `book/` keeps only `book.json`, `SUMMARY.md`, `README.md`, `.gitignore`. New chapter: drop `.md` into `docs/`, add to `book/SUMMARY.md`, extend the `cp` step in both `pages.yml` and the `pages-build` Makefile target.

- **Honkit fails silently in two ways producing a 1-page book.** (1) Reads `.gitignore` from its source dir and drops matching files (chapter filenames in `book/.gitignore` makes them all vanish). (2) Resolves `SUMMARY.md` paths relative to `cwd`, not the source arg — `npx honkit build book book/_book` from repo root parses SUMMARY but can't find chapters. Both surface as `info: found 1 pages`. The staging-dir workaround above sidesteps both.

- **Honkit asset-copies any non-markdown file in its source dir** while preserving paths. To embed images in a chapter, drop them into a subdir under the staging dir — `pages-build` + `pages.yml` already do `mkdir -p _stage/book/testdata && cp testdata/*.png _stage/book/testdata/`. Reference as `testdata/foo.png` — same path works in GitHub-rendered markdown (`README.md` reuses it). New asset-bearing chapter: add `mkdir -p` + `cp` to both `pages.yml` and Makefile, plus the `paths:` trigger if outside `docs/`/`book/`.

- **macOS in-DMG `README.txt` lives at `docs/dmg/README.txt`** — single source for drag-install + Gatekeeper steps; `scripts/release/make-dmg.sh` copies it into the DMG. `docs/install-macos.md` sections 2-3 mirror it (slightly expanded for web). Synced pair flagged by an HTML comment at the top of the install-macos.md region — edit one, check the other.

- **Release-time shell lives in `scripts/release/`** (not inline in `release.yml`): `package-linux.sh`, `make-dmg.sh`, `sign-image.sh`, `flip-package-public.sh`, `compute-sha256.sh`. Each reads inputs from env vars set in the workflow step. Add new release-time logic as a `scripts/release/*.sh` (covered by `make lint-shell` via the `SHELL_SCRIPTS` glob).

- **A failing workflow doesn't block merge until it's a required status check.** `pr-compliance.yml` fails on missing checkboxes but PRs still merge unless added to Settings → Branches → main → "Require status checks to pass". Same one-time-UI-setup shape as `pages.yml` (Source = GitHub Actions). Any new gate needs the flip.

- **Adding a field to an existing Go struct** is 2 steps: (1) update struct + OpenAPI schema, (2) `make gen-types` to refresh `api.gen.d.ts`. `frontend/wailsjs/` is gitignored + regenerated by `wails build`; contract lives in `api.gen.d.ts` for both transports.

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

- **`pkg/parser/heroes.yaml` + `maps.yaml` are the source of truth for the OW roster.** Both `//go:embed`'d in `owdata.go` and parsed at `init()` into `parser.HeroesByRole` + `parser.MapsByType` (canonical display) plus normalized lookup tables (`heroRoles`, `mapTypes`, `heroDisplayNames`, `mapDisplayNames`, `knownMaps`). Adding a hero/map: edit YAML, rebuild — no Go edits needed. `normalize()` (lowercase + diacritic-strip + colon-strip + whitespace-collapse) handles diacritics ("Lúcio") and colons ("Soldier: 76"). Consumers: `App.GetOWData()` (Wails / `/api/v1/system/reference-data`); `useOWData.ts` (session-singleton → `heroDisplayName(stored)` / `mapDisplayName(stored)`). **Hero-substring collision** ("Mizuki" can shadow "Mei" in OCR text with BattleTags) is a known vector — `extractHeroes` is longest-match-wins. After a YAML change, `make update-goldens RECALL_FIXTURE_DIR="$PWD/testdata"` surfaces collisions when goldens flip.
- **Frontend imports from `'./api'`** (resolves to `frontend/src/api.ts`) — transport-agnostic shim typed against `api.gen.d.ts`. Wails mode delegates to `window['go']['app']['App']`; server mode uses `fetch('/api/v1/...')` + `EventSource('/api/v1/events')`. Adding a new exported method on `App` is 3 steps: (1) add to a `pkg/app/*.go` file; (2) add the route + schema to `api/openapi.yaml` (pick the right verb — GET/PUT/POST/DELETE — and mount on `apiMux`, not the outer `mux`), run `make gen-types`; (3) add the wrapper to `api.ts` with BOTH the Wails delegation and the `fetch` path. Skipping (3) silently breaks server mode while Wails keeps working.
- **The `_screenshot/<filename>` URL prefix** is reserved for the
  on-disk screenshots handler. Don't reuse it for other dynamic assets.
- **HTTP array responses initialize to `make([]T, 0)`, never `var x []T`** — a nil slice marshals to `null` which violates `type: array` and trips schemathesis's `response_schema_conformance` in CI. Canonical: `aggregateAll` + the per-table loaders in `pkg/db/store.go`.
- **Bad client/config input is 4xx, not 5xx.** App layer returns a typed sentinel (`app.ErrInvalidScreenshotsDir`, `fmt.Errorf("%w: ...", sentinel, ...)`); HTTP handlers `errors.Is` it to 400, everything else falls through to 500. Reserve 5xx for unexpected internal failures; anything reproducibly triggered by user input is 4xx. Canonical handlers: `PUT /api/v1/settings/screenshots-folder`, `POST /api/v1/parses`.
- **Smoke-test the server with isolated HOME** — `recall-server` from repo root hits real user data (`./screenshots` exists; settings + SQLite live in the platform user-config dir). For fresh-install behavior: `HOME=/tmp/recall-smoke RECALL_SERVER_ADDR=127.0.0.1:7099 ./recall-server` from a dir with no `./screenshots`. Clean up with `rm -rf /tmp/recall-smoke/Library`.
- **`set -u` not `-e`** in shell scripts that should keep going after an
  individual failure (`verify-stack.sh` is the canonical example).
- **Read-time inference, not merge-time.** `pkg/app/inference.go` helpers (`inferSoleHeroPercent`, `inferResultFromRank`) run on the way *out* via `GetMatchResults` / `scrapeReader` — never inside `mergeMatchResult` or any write path. Storing an inferred value would shadow a later screenshot's real value in the first-non-empty-wins fold (e.g. inferred `result="victory"` from SR change would block a SUMMARY's authoritative `result`).
- **Wails AssetServer custom routes need Middleware, not Handler, in dev mode.** `Options.Handler` only fires on 404/405, but Vite's SPA fallback returns `index.html` with 200 for unknown routes — path-prefixed handlers (`/_screenshot/`) never run. `pkg/cmd/wails.go` registers `ScreenshotHandler` as Middleware that short-circuits before the proxy. Production works either way; only `wails dev` needs Middleware.
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
- **Commits**: Conventional Commits prefix (`feat` `fix` `chore` `docs` `refactor` `test` `perf` `build` `ci` `revert` `style`) enforced by lefthook's `commit-msg` + Linux kernel style body (subject ≤ 72 chars imperative no-period, body wrapped at 72 explaining *why*). One logical change per commit. release-please reads prefix for version bumps. Bypass once with `LEFTHOOK_EXCLUDE=conventional`. Example in CONTRIBUTING.md.
- **User-controlled paths from HTTP go through a boundary validator before `exec.Command` / `os.Stat`.** Canonical: `validateScreenshotsDir` (`screenshots_dir.go`) + `validateTesseractPath` (`tesseract.go`) — shared `safePathChars` regex + `filepath.Clean` equality + return the cleaned value so the sanitized form reaches syscalls. CodeQL recognizes this as a sanitizer for `go/command-injection` + `go/path-injection`. New path-accepting endpoints must reuse `safePathChars` (permissive enough for Windows `Program Files (x86)\…` + usernames with apostrophes/parens).
- **Windows Tesseract installer paths contain spaces and parens** —
  `defaultTesseractPath()` returns `C:\Program Files\Tesseract-OCR\…`
  or `C:\Program Files (x86)\Tesseract-OCR\…` on Windows. Any regex
  that constrains path strings must allow `()` or it'll reject the
  Windows default out of the box (one of the test cycles spent
  tracking this down — don't repeat).
- **`gh workflow run --ref TAG` reads the workflow definition from that ref.** A `workflow_dispatch:` added later on `main` is invisible to tags cut before — those can't be fired manually. `release.yml` has `workflow_dispatch:` from `v0.0.12-beta.0` onward. Procedure: [RELEASES.md](RELEASES.md) → "When `release.yml` doesn't auto-fire".
- **NSIS installer** — `wails build -nsis` needs `nsis` apt package in `windows-builder` stage for `makensis`. `VIProductVersion` in `project.nsi` must be numeric `x.x.x.x` — strip pre-release suffix before injecting (`0.0.10-beta.0` → `0.0.10` via `grep -oE '^[0-9]+\.[0-9]+\.[0-9]+'`, fallback `0.0.0` for `dev`). Output: `build/bin/${INFO_PROJECTNAME}-${ARCH}-installer.exe`. Install path: `$PROGRAMFILES64\${INFO_PRODUCTNAME}` (no company subfolder).
- **Build provenance attestation** — `actions/attest-build-provenance@v2` needs `id-token: write` + `attestations: write` at the job. Attest binaries in build jobs AND sha256 files in the release job. Verify: `gh attestation verify <file> --repo sound-barrier/recall`. Does NOT replace Windows Authenticode.
- **cosign keyless image signing** — every GHCR tag from `publish-container` is signed via `cosign sign --yes "${tag%:*}@${DIGEST}"`. Sign by digest (not tag — re-point would silently break verification). Keyless OIDC: the Actions identity IS the signing identity (no key material; requires `id-token: write`). User verify recipe in [docs/docker.md](docs/docker.md). Complements (doesn't replace) build-provenance — provenance proves "built by this workflow," cosign proves "bits weren't tampered with after upload." Pin: `cosign-release: 'v2.4.1'`.
- **`# hadolint ignore=DL4006`** above any Dockerfile `RUN` containing a shell pipe; same shape as `# hadolint ignore=DL3008` for unpinned apt.
- **Quote every hex color in `.github/labels.yml`.** YAML 1.1 parses unquoted `5319e7` as scientific notation, `008672` as octal losing leading zeros — both fail label-sync's `color should be a string`. Always `color: "008672"`.
- **`actions/setup-go@v6` sets `GOTOOLCHAIN=local`** which docker steps inherit, so any docker action with bundled Go older than `go.mod`'s `go 1.26.x` fails (`go: go.mod requires go >= 1.26.x ... GOTOOLCHAIN=local`). Fix: install the tool via `go install ...@vX.Y.Z` to use setup-go's install (what the gosec job does). Don't switch to `GOTOOLCHAIN: auto` or skip setup-go.
- **Any CI job that loads the root `main` package must first satisfy `//go:embed all:frontend/dist`.** `assets.go` embeds the Vite output; on a fresh runner `frontend/dist/` is missing and `go build` / `go list` / `gosec` fails with `pattern all:frontend/dist: no matching files found`. Use `.github/actions/prepare-frontend-dist` with `real-assets: 'true'` (~30s Vite bundle — e2e, coverage, bundle-size) or `'false'` (stub — gosec, deadcode, CodeQL). Ad-hoc inline `mkdir -p frontend/dist` is forbidden.
- **release-please / dependabot / web-UI-merge commit identity comes from the GitHub account's primary email**, not from any repo file. release-please uses `secrets.RELEASE_PLEASE_TOKEN`'s account; dependabot merges + "Merge PR" UI clicks stamp the merger's email. Fix wrong bot-commit email at github.com → Settings → Emails.
