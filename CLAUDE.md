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

**Where to look first**, by question type:

- *How do I build / test / lint / release?* → "Build, run, dev" table
- *Where does the OCR pipeline read / write?* → "Data flow", "How match merging works", "Per-screenshot-type parsers"
- *Where is `<feature>` implemented?* → "App shell" (Go) or "Frontend" (Vue) — both list per-concern file inventories
- *Is `<thing>` a documented gotcha?* → "Conventions worth knowing" (66 bullets, search by keyword)
- *How does CI / release wiring work?* → "CI/CD" + the `release.yml` detail subsection

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
| `make init` | One-shot setup for a fresh clone — delegates to `./initialize.sh`. Detects macOS vs Debian/Ubuntu, runs `brew bundle` or `apt install`, the `go install` lines for tools not in Brewfile (Wails CLI, gofumpt, goimports-reviser, deadcode, govulncheck), drops the `webkit2gtk-4.0` → `4.1` pkg-config shims on Debian, `cd frontend && npm ci`, `lefthook install`, and `direnv allow`. Idempotent. Fails fast if Go 1.26+ / Node 22+ aren't already on PATH (install those yourself first). |
| `make dev` | Hot-reload dev server (macOS or Debian/Ubuntu). Vite on `:5173`, Wails IPC dev on `:34115`. Auto-rebuilds Go on save. On Linux the Makefile passes `-tags webkit2_4_1` automatically because Wails v2.12.0's CGo references `webkit2gtk-4.0` (Debian bookworm+/Ubuntu 24.04+ only ship 4.1; the build tag + pkg-config shims that `initialize.sh` plants both target the same compatibility gap). |
| `make build-linux` | Linux/amd64 Wails app → `dist/linux/Recall` via Docker. |
| `make build-windows` | Windows/amd64 Wails app → `dist/windows/Recall.exe` via Docker + mingw-w64. |
| `make build-mac` | macOS Wails app → `dist/mac/Recall.app`. Must run on macOS. The release-workflow DMG step (in `release.yml`) re-stages this into a `dmg-staging/` dir alongside an `Applications` symlink and a `README.txt`; the local target stops at the `.app` for fast iteration. |
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
| `make check-deps` | Compare every pinned tool version against its latest upstream release. Covers Wails CLI, hadolint, lefthook, trivy (parsed from `.devcontainer/postCreate.sh`) plus Spectral, typos, gosec, Honkit (from `tool-versions.env`), and asserts the literal `crate-ci/typos@vX.Y.Z` SHA-pinned action ref's trailing comment in `ci.yml` matches `$TYPOS_VERSION`. Exits 1 if any are behind. Go/Node rows are informational only. |
| `make trivy` | Trivy vulnerability scan (Go modules + npm + Dockerfile); fails on HIGH/CRITICAL. |
| `make cloc` | Count lines of source code (summary table; exclusions in `.clocrc`). |
| `make cloc-detail` | Same as `make cloc` plus per-file breakdown — use when investigating a delta. |
| `make icon` | Resync `build/appicon.png` from `assets/icon.png` (1024×1024 via `sips`, macOS-only) and clear `build/windows/icon.ico` so Wails regenerates platform icons (`.icns` for macOS, `.ico` for Windows) on next `wails build`. |
| `make swagger` | Serve `api/openapi.yaml` via Swagger UI v5 in a container (`$(DOCKER) run`, default port `:8080`; override with `SWAGGER_PORT`). Same spec is also published publicly at <https://sound-barrier.github.io/recall/api/> via `pages.yml`. |
| `make pages-build` | Build the docs book + Swagger UI under `dist/pages/` — mirrors the staging dance in `pages.yml` so what previews locally matches what CI deploys. Honkit pin is `HONKIT_VERSION` (default 6.0.2) and tracks the same env var in the workflow. |
| `make pages-preview` | `make pages-build` then `python3 -m http.server` on `$(PAGES_PORT)` (default `:4000`) serving the built site. Use this before pushing doc changes to catch broken chapter renders without burning a CI deploy. |
| `make lint-openapi` | Lint `api/openapi.yaml` via Spectral (`spectral:oas` + `.spectral.yaml`) with `--fail-severity=warn`. Also run as part of `make lint`. |
| `make test` | Run all tests: Go unit tests (`-race`; `pkg/{app,db,parser}/*_test.go`) + Vitest (`frontend/src/**/*.test.ts`). Parser golden-file integration tests in `pkg/parser/integration_test.go` default to scanning the repo-root `testdata/` dir (via `../../testdata` from the package's cwd) — point `RECALL_FIXTURE_DIR` at any absolute path to override. CI runs `go test -race -short ./...` which skips the golden-file test in `-short` mode. |
| `make cover` | Generate both Go and frontend coverage reports (umbrella; delegates to `cover-go` + `cover-frontend`). |
| `make cover-go` | Generate Go coverage report; writes per-function text summary and HTML to `coverage/go/` (gitignored). Fails when total coverage < `GO_COVERAGE_MIN` (default 46%, tuned a few points below the current ~48% so genuine regressions trip the gate). Override on the CLI for ad-hoc runs. Ratchet upward at every release. |
| `make cover-frontend` | Generate JS/TS coverage report via Vitest + V8 (`@vitest/coverage-v8`); writes text summary, lcov, and HTML to `frontend/coverage/` (gitignored). Fails when any of the four `coverage.thresholds` in `vitest.config.ts` aren't met (currently statements/lines 70, branches 60, functions 55). |
| `make gen-types` | Regenerate `frontend/src/api.gen.d.ts` from `api/openapi.yaml` (uses `openapi-typescript`). Run after every spec edit; CI fails if the committed `.d.ts` is out of sync. |
| `make typecheck` | `vue-tsc --noEmit` — covers `.ts` files and `<script lang="ts">` blocks in `.vue` files. `allowJs: false` in tsconfig means no JS can be introduced silently. |

**Package layout (`pkg/`)**:

| Package | Contents |
|---|---|
| `pkg/app` | `App` struct + per-concern files: `settings.go`, `tesseract.go`, `watcher.go`, `metrics_lifecycle.go`, `update.go`, `screenshots_dir.go`, `screenshot_handler.go`, `inference.go`, `match_record.go`, `merge.go`, `parse.go`, `sse.go`. Build-tag pair `app_wails.go` / `app_server.go` for dialog methods + event emit |
| `pkg/cmd` | `RunWails` (Wails init) and `RunServer` (HTTP server + REST API) |
| `pkg/db` | SQLite `Init()` + `DB` variable |
| `pkg/metrics` | Prometheus `Collector` + `Server` |
| `pkg/parser` | OCR pipeline split per concern: `parser.go` (dispatcher + `ParseScreenshotsDir`), `types.go`, `heroes.go`, `maps.go`, `tesseract.go`, `imageutil.go`, `text.go`, `parse_rank.go`, `parse_summary.go`, `parse_personal.go`, `parse_scoreboard.go`, `exec_{other,windows}.go` (HideWindow build-tag pair) |

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

## Data flow (the big-picture architecture)

```text
screenshots/*.png
      │
      ▼  (Tesseract via parser.ParseScreenshot, dispatched per screenshot type)
parser.MatchResult
      │
      ▼  (pkg/app/parse.go: screenshotType + resolveMatchKey, then per-type Upsert)
SQLite per-type tables:
   summary_screenshots + summary_heroes_played
   scoreboard_screenshots + scoreboard_hero_stats
   personal_screenshots + personal_hero_stats
   rank_screenshots + rank_modifiers + rank_sr
   unknown_screenshots          ← source of truth (one row per screenshot)
      │
      │  (read time: pkg/app/aggregate.go::aggregateAll bulk-loads,
      │   groups by match_key, folds via mergeMatchResult)
      ▼
   MatchRecord
      │
      ├──→ Wails GetMatchResults() ──→ Vue UI (App.vue)
      │
      └──→ metrics.Collector reads on every Prometheus scrape ──→ Grafana
```

**SQLite is the source of truth.** The raw per-screenshot rows are
preserved verbatim — aggregation (folding multiple screenshots into one
match) happens at read time, so a wrong scalar from one screenshot can
be corrected later by adding another screenshot to the match. The
Prometheus collector reads via the same aggregator on every scrape;
filters (e.g. competitive-only) live at the metrics boundary in
`pkg/metrics/metrics.go::Collect`, **not** in the parser or DB — so
quickplay matches are visible in the Wails UI but never reach Grafana.

## How match aggregation works (the hard part)

A single match produces 3-5 screenshots (SUMMARY, TEAMS, PERSONAL ×N
heroes, optional rank screen). Each populates a disjoint subset of
fields on `parser.MatchResult`. The pipeline splits into two halves:

**Write path** (`pkg/app/parse.go`, `pkg/app/correlation.go`): each
screenshot is OCR'd and inserted into its own per-type table
(`UpsertSummary`, `UpsertScoreboard`, `UpsertPersonal`, `UpsertRank`,
`UpsertUnknown`). The new row's `match_key` is resolved by
`resolveMatchKey`, which scans every parent table for an existing
screenshot to adopt the key from:

1. **EAD-signature match** — any existing scoreboard with the same
   non-zero `(eliminations, assists, deaths)` and no `(map, hero)`
   conflict. Bridges in-game scoreboard ↔ post-match summary.
2. **Timestamp-window match** — any existing screenshot within
   `mergeWindow` (2 min) with no signature conflict. Closest-in-time
   wins — handles a PERSONAL screenshot landing between two adjacent
   SUMMARY windows.
3. **Fresh key** — `match:<earliest-filename-ts>`, or
   `unmatched:<filename>` for files without a parseable timestamp.

Re-parsing the same filename triggers `ON CONFLICT(filename) DO UPDATE`
on the parent (children are DELETE-then-INSERT inside the same
transaction; `PRAGMA foreign_keys = ON` makes the cascade reliable).
The Parse button is idempotent — re-clicking replaces rows in place,
no duplicates.

**Read path** (`pkg/app/aggregate.go::aggregateAll`): bulk-SELECTs every
row across the 5 parent tables, attaches child rows, groups by
`match_key`, sorts each group by `(filename-timestamp asc, parsed_at
asc)`, and folds via `mergeMatchResult` — the same "first non-empty
wins" precedence the old destructive merge used, just running on the
read side now. `role` (from hero) and `type` (from map) are resolved
on the fly via `parser.HeroRole` / `parser.MapType`, never stored.

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

## Database layer (`pkg/db/db.go`)

Ten tables in 3NF: five **parent** tables (one per screenshot type) plus
five **child** tables for the repeating-group fields:

| Parent | Children |
|---|---|
| `summary_screenshots` (scalar SUMMARY fields + 6 inlined `perf_*` columns) | `summary_heroes_played` (hero, percent_played, play_time) |
| `scoreboard_screenshots` (E/A/D + damage/healing/mit + map/mode/hero) | `scoreboard_hero_stats` (hero, stat_key, stat_value) |
| `personal_screenshots` (hero only) | `personal_hero_stats` (hero, stat_key, stat_value) |
| `rank_screenshots` (rank/level/progress/change/result) | `rank_modifiers` (modifier), `rank_sr` (hero, sr, change) |
| `unknown_screenshots` (no domain fields) | *(none)* |

Each parent has `id INTEGER PK AUTOINCREMENT`, `filename TEXT UNIQUE`,
`match_key TEXT NOT NULL`, and `parsed_at DATETIME DEFAULT
CURRENT_TIMESTAMP`. Each child references its parent with
`ON DELETE CASCADE` and has a composite PK that prevents duplicate
fold-ins on re-parse. **`NewSQLStore` must `PRAGMA foreign_keys = ON`**
— SQLite parses the CASCADE rules but only enforces them when this
pragma is set on every connection.

**Derived fields are not stored.** `role` is computed from `hero` via
`parser.HeroRole`, `type` from `map` via `parser.MapType`; both lookups
hit the YAML-derived in-memory tables (`pkg/parser/heroes.yaml`,
`pkg/parser/maps.yaml`). Storing them would be a 3NF violation
(transitive dependency) and would surface as "row A says juno=support
but row B says juno=dps" inconsistencies after a YAML change.

**Write path** (per screenshot, inside one `BEGIN…COMMIT`):

1. Parent UPSERT via `ON CONFLICT(filename) DO UPDATE SET … RETURNING id` —
   note `parsed_at` is intentionally **not** in the SET clause so the
   first-insert timestamp survives re-parses.
2. `DELETE FROM <child> WHERE <parent>_id = ?` to wipe stale children.
3. `INSERT INTO <child> …` for every new child row.

The DELETE-then-INSERT (instead of UPSERT) for children is deliberate:
each child PK is a composite `(parent_id, hero[, stat_key])`, and a
re-parse that drops a hero from `HeroesPlayed` must wipe that hero's
old row — UPSERT alone wouldn't remove it.

**Read path** (`pkg/app/aggregate.go`): five parent SELECTs + five
child SELECTs grouped by parent id, then re-keyed by `match_key` and
folded via `mergeMatchResult`. No N+1 query risk — every table is hit
exactly once per `aggregateAll` call (called from `GetMatchResults` and
on every Prometheus scrape).

Adding a new parser scalar field: add an `ALTER TABLE … ADD COLUMN`
statement (idempotent — "duplicate column" errors are tolerated) to
the appropriate parent table, plus the field on the matching `*Row`
struct in `pkg/db/store.go`, plus the Upsert SET clause. Adding a new
repeating-group dimension: a new child table referencing the right
parent with `ON DELETE CASCADE`.

The DB lives at `<appDataDir>/db/recall.db` where `appDataDir()` in `pkg/app/settings.go`
resolves to the platform user-config directory:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Recall/db/recall.db` |
| Linux | `~/.config/recall/db/recall.db` (or `$XDG_CONFIG_HOME/recall/db/`) |
| Windows | `%AppData%\Recall\db\recall.db` |

Match identity is `match_key` — string identity, **no integer `id`**
on the API surface. The aggregator builds it on the fly from the parent
tables; identity is derived from the earliest screenshot's filename
timestamp (`match:2026-05-10T21:29:28`). Files without a parseable
timestamp get `unmatched:<filename>`.

Per-source-file screenshot type is the parent table the row lives in —
no separate `source_types` column required. `MatchRecord.SourceTypes`
is built at aggregate time from each row's parent table name.

The `parsed_at` column is the row's first-insert time, not the match's
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
| `pkg/app/app.go` | *(none)* | `App` struct + `New` / `NewWithStore` / `Startup` only (~130 lines). Wires settings, tesseract probe, DB, optional metrics + watcher startup. |
| `pkg/app/settings.go` | *(none)* | `Settings` JSON type, `loadSettings` / `loadSettingsFrom` / `saveSettings`, `appDataDir` / `settingsPath` |
| `pkg/app/tesseract.go` | *(none)* | `TesseractStatus`, `defaultTesseractPath`, `checkTesseract`, `parseTesseractVersion`, `Get/Set/ResetTesseractPath`, `validateTesseractPath`, `ErrInvalidTesseractPath` |
| `pkg/app/watcher.go` | *(none)* | fsnotify lifecycle: `startWatching` / `stopWatching` / `runWatchEvents` / `scheduleParseDebounced`, `Get/SetWatchEnabled`, `watchDebounce` |
| `pkg/app/metrics_lifecycle.go` | *(none)* | Prometheus server start/stop, `Get/SetPrometheusEnabled` |
| `pkg/app/update.go` | *(none)* | `UpdateInfo`, `GetVersion`, `CheckForUpdate`, `Version` ldflag, `releasesURL` test seam |
| `pkg/app/screenshots_dir.go` | *(none)* | `Get/SetScreenshotsDir`, `validateScreenshotsDir`, `safePathChars`, `ErrInvalidScreenshotsDir` |
| `pkg/app/screenshot_handler.go` | *(none)* | HTTP handler at `/_screenshot/<filename>` |
| `pkg/app/inference.go` | *(none)* | `scrapeReader` + the load-bearing `inferSoleHeroPercent` / `inferResultFromRank` read-time helpers |
| `pkg/app/match_record.go` | *(none)* | `MatchRecord` type, `GetMatchResults`, `ClearDatabase`, `readAllRecords`, `rowToMatchRecord`, `GetNewScreenshotCount` |
| `pkg/app/merge.go` | *(none)* | `mergedRow`, `mergeWindow`, `parseFilenameTimestamp`, `mergeByTimestamp`, `mergeByStatsSignature`, `splitByMatchMetadata`, `mergeMatchResult`, `mergeTypeMaps`, `upsertMergedRow`, `marshalIfPresent`, conflict helpers |
| `pkg/app/parse.go` | *(none)* | `ParseScreenshots` orchestration, `ParseProgressEvent`, `screenshotType` classifier, `findMergeIntoExisting`, `loadExistingMergedRows`, `timestampWindowOverlap`, `rowsConflict`, `unionSortedStrings` |
| `pkg/app/app_wails.go` | `!serveronly` | `emitParseComplete` (wruntime.EventsEmit + SSEHub), `PickTesseractBinary`, `PickScreenshotsDir` |
| `pkg/app/app_server.go` | `serveronly` | `emitParseComplete` (SSEHub only), stub errors for the two dialog methods |
| `pkg/app/sse.go` | *(none)* | Exported `SSEHub` type with `Subscribe/Unsubscribe/Broadcast` |

The split mirrors the existing test-file partition (`settings_io_test.go`, `tesseract_version_test.go`, `watch_events_test.go`, etc.) — production code and tests now have a 1:1 file-pair shape, so finding the implementation behind a test failure is a filename swap, not a grep.

**Wails-bound methods (called from Vue via `wailsjs/go/app/App`)**:
`ParseScreenshots`, `GetMatchResults`, `GetScreenshotsDir`,
`SetScreenshotsDir`, `PickScreenshotsDir`, `GetPrometheusEnabled`,
`SetPrometheusEnabled`, `GetWatchEnabled`, `SetWatchEnabled`,
`GetTesseractStatus`, `SetTesseractPath`, `PickTesseractBinary`,
`ResetTesseractPath`, `ClearDatabase`, `GetNewScreenshotCount`,
`GetVersion`, `CheckForUpdate`.

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
shape in any of the `pkg/app/*.go` or `pkg/parser/*.go` files, edit the spec to
match. `make lint-openapi` runs Spectral against it (strict on warnings
— the `spectral:oas` ruleset emits most useful issues as warnings, not
errors, so the `--fail-severity=warn` flag in the Makefile is
deliberate). `make swagger` renders the spec in Swagger UI for
browsing.

**Wails-bound HTTP handler**: `ScreenshotHandler()` serves
`/_screenshot/<filename>` from the configured screenshots dir — used by
both the Wails `AssetServer.Handler` and the server-mode HTTP mux.

## Frontend (`frontend/src/App.vue`)

**Style layout.** App.vue's `<script>` and `<template>` live in the SFC
(~890 lines combined). Component-specific styles live in each leaf
SFC's own `<style scoped>` block (Vue scoping rewrites every selector
with a `[data-v-<hash>]` attribute, so the rule only matches elements
in that component's template). Cross-cutting / shared styles —
custom properties, font-faces, theme overrides, the `.btn` family,
`.badge` family, `.chev`, `.length`, `.clickable`, shared empty-state
selectors, `.section-*` / `.setting-*` / `.settings-*` (used across
Settings + Ingest + Unknown views), `.slot-chip` / `.slot-dot`
(shared between MatchCard's sources-coverage strip and
UnknownMapsView's slot row), and `.source-name` / `.source-file` /
`.source-preview` family (shared between MatchCard and
UnknownMapsView) — stay in `frontend/src/styles/app.css` (~1 850
lines, down from ~3 700). When migrating a new rule to scoped, check
all eight component templates first; if more than one references the
class, leave it in `app.css`. Theme overrides in a scoped block need
`:global([data-theme="light"])` so the selector pierces the scope
hash. @keyframes defined in a scoped block get their NAME hashed, so
animations referenced from multiple components must live in
`app.css` (`pulse-dot` is the canonical example — referenced by
ParseProgressPanel + IngestView).

Pure helpers (date formatting, screenshot-type detection, hero sorting,
etc.) live in `frontend/src/match-helpers.ts` so they can be unit-tested
in isolation via Vitest. Stateful logic is extracted into composables under
`frontend/src/composables/`: `useTheme` / `useWeekStart` /
`useIncludeUndated` (persisted-preference composables — all follow the
same shape: `ref(default)` + `setX(next)` that writes localStorage +
`onMounted` reader. Add new prefs by copying one; mountApp's
`MountOverrides` seeds the matching localStorage key for SFC tests),
`useFilterPanel` (popover open/close, ESC/outside-click),
`useMatchFilters` (all 7 filter refs + the optional `includeUndated`
ref, date range, sort, filtered/sorted computeds — the most complex
and highest-test-ROI module), `useMatchGrouping` (Month→Week→Day tree
plus expand state). Shared UI is in
`frontend/src/components/`: `MatchCard`, `FilterRail`, `ParseProgressPanel`,
`MatchGroupSection`, plus the four top-level view tabs — `SettingsView`,
`IngestView`, `MatchesView`, `UnknownMapsView`. App.vue is now a router-
shell: masthead, modals, cross-cutting state (records, expand/preview
maps, composable instances), then four `<XxxView v-if="view === '…'" />`
mounts that receive props and bubble events back via `emit('go-to-view',
…)` etc. Per-card UI state (expand, sources, preview) lives in App.vue
and is passed to MatchesView + UnknownMapsView via the `CardStateApi`
bundle exported from MatchesView.vue so both views share it without
forking.
When adding a new pure helper that takes plain inputs and returns plain
outputs, add it to `match-helpers.ts` with a Vitest case; stateful logic
goes in a new composable under `composables/`. Don't define either inside
the SFC's `<script setup>`. SFC-level tests use `@vue/test-utils`'s
`mount()` via the `mountApp(overrides?)` helper in
`frontend/src/test-utils/mountApp.ts`, which `vi.doMock`s `./api` so the
Wails/fetch shim never fires during mount. `App.test.ts` shows the
pattern: each test calls `await mountApp({ records: [...] })` then
asserts on the wrapper's rendered DOM. The entire frontend is TypeScript (`allowJs: false`);
ESLint uses `typescript-eslint` (`tseslint.config()` in `eslint.config.js`)
with `parserOptions.parser: tseslint.parser` wired in for `.vue` files.
Template access to `Record<string, Ref<string[]>>` filter state goes through
`filterList(field)` / `filterSearchStr(field)` helpers to satisfy
`noUncheckedIndexedAccess` without littering the template with `!` or `??`.

Vue 3 + composition API. No router, no Vuex/Pinia — App.vue is the
router-shell (masthead + modals + cross-cutting state) that mounts one
of four view SFCs at a time (see the components list above). State
concerns owned by App.vue and passed down via props/emits:

- **Nav** — four tabs in workflow order: **Settings (01)** (directories
  - appearance + calendar/first-day-of-week), **Ingest (02)** (engine /
  parse / export / data),
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
- **Settings page**: three sections in `SettingsView.vue` — Directories
  (screenshots folder picker), Appearance (Day/Night theme toggle),
  Calendar (Sun/Mon first-day-of-week toggle). All persisted via the
  useTheme / useWeekStart / useIncludeUndated composable family. Engine /
  Watch / Parse / Prometheus knobs moved to the **Ingest** tab during the
  view extraction.
- **Tesseract gate**: `tesseractReady` computed drives a System Alert
  banner and disables Parse/Watch controls when the OCR engine isn't
  found. `GetTesseractStatus` / `SetTesseractPath` / `PickTesseractBinary`
  / `ResetTesseractPath` are the four Wails-bound methods for engine config.
- **Unknown Maps view**: records where `data.map` is absent surface in a
  separate Unknown Maps page via the `unknownRecords` computed. Per-card
  UI state (expand, sources, preview) is shared with the Matches view via
  the `CardStateApi` bundle exported from `MatchesView.vue` — App.vue
  owns the underlying refs, both views consume them through one prop.
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

Nine workflows:

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push or PR to `main` | **Lint** (golangci-lint × both build tags, ESLint + typescript-eslint, Stylelint, HTMLHint, Hadolint, yamllint, Spectral) → **frontend build** → **bundle-size budget** (initial JS < 130 KB / initial CSS < 80 KB / total JS < 250 KB / total CSS < 120 KB) → **Go + Vitest unit tests** → **TypeScript `vue-tsc --noEmit`** → **"api.gen.d.ts in sync with `openapi.yaml`" check**. Plus parallel build jobs for Linux/Windows Wails + all server binaries + container image + macOS Wails. Security jobs: **Trivy** (multi-language vuln scan; SARIF uploaded to GitHub Security tab), **govulncheck** (Go call-graph-aware CVE scan, both build tags), and **gosec** (Go-idiom SAST — file modes, weak crypto, Slowloris timeouts, taint-tracked path/command/log injection; both build tags via `go install github.com/securego/gosec/v2/cmd/gosec@${GOSEC_VERSION}` against the runner's setup-go Go install — NOT the `securego/gosec` docker action, which bundles its own stale Go and breaks against this project's `go 1.26+` toolchain requirement). Dead-code job: **deadcode** (whole-program Go analysis, `serveronly` tag only — Wails methods are reflection-called so only the HTTP-handler variant gives a reliable call graph) + **knip** (unused TypeScript exports and stale devDependencies). Coverage jobs: **coverage-go** (runs `make cover-go`, fails when total < `GO_COVERAGE_MIN` = 46%; HTML + func summary + cobertura uploaded as a 30-day artifact) and **coverage-frontend** (Vitest + V8 against the thresholds in `vitest.config.ts` — currently 70 stmts / 70 lines / 60 branches / 55 functions — HTML + lcov + cobertura uploaded as a 30-day workflow artifact). **PR-only comments**: the lint job runs `EnricoMi/publish-unit-test-result-action` over Go + Vitest JUnit XML to post a sticky "Unit test results" comment (workflow gate now driven by its `fail_on: test failures`, not the test step itself); **coverage-comment** depends on both coverage jobs and feeds their Cobertura XMLs into `irongut/CodeCoverageSummary` + `marocchino/sticky-pull-request-comment` for a sticky `coverage`-keyed comment. Real coverage gates stay upstream (Vitest thresholds + `GO_COVERAGE_MIN`); the comment uses `fail_below_min:false` to avoid double-gating. Drift job: **schemathesis** fuzzes a freshly-built server against `api/openapi.yaml`. |
| `codeql.yml` | Push to `main` | GitHub CodeQL static analysis for Go + JavaScript/TypeScript. Findings appear in the Security tab; surfaced by the CodeQL badge on the README. |
| `dependency-review.yml` | PR to `main` | Blocks PRs introducing dependencies with vulnerabilities or disallowed licenses (uses `actions/dependency-review-action`). |
| `pr-compliance.yml` | PR to `main` (`opened`, `edited`, `synchronize`, `reopened`) | Grep-checks the PR description for the two ticked checkboxes the template requires: Code of Conduct acceptance + Apache-2.0 license grant. Fails with a clear `::error::` if either is missing; re-runs on `edited` so a contributor can tick the boxes without pushing a new commit. Exempts trusted automated PRs: `dependabot[bot]`, `github-actions[bot]`, AND any PR whose branch starts with `release-please--` — release-please runs under the maintainer's PAT in this repo (so CI fires on the PR, see release-please.yml row), which means the author login is human, NOT a bot, so branch-name prefix is the reliable signal. Body is read via the `PR_BODY` env var, never `${{ }}`-interpolated into the shell — the documented script-injection-safe pattern. |
| `e2e.yml` | Push/PR to `main` (paths: `frontend/**`, `pkg/**`, `**/*.go`, `api/openapi.yaml`, `e2e.yml`) | Browser E2E via Playwright. Builds the frontend (Vite → `frontend/dist`), builds the serveronly binary (with `//go:embed` pulling in the built dist), then `npx playwright install --with-deps chromium` and runs `frontend/tests/e2e/*.spec.ts`. The Playwright config's `webServer` block boots `/tmp/recall-e2e/recall-server` on `127.0.0.1:7099` with `HOME=/tmp/recall-e2e` for hermeticity — same isolation pattern documented in the Conventions section's smoke-test-with-isolated-HOME bullet. Separate from `ci.yml` so the lint/unit jobs stay fast when frontend/ wasn't touched. Uploads `frontend/playwright-report/` as a 7-day artifact on failure. |
| `labels.yml` | Push to `main` (paths: `.github/labels.yml`, `.github/workflows/labels.yml`) + `workflow_dispatch` | Syncs the repo's labels to match `.github/labels.yml` (declarative source of truth — Conventional Commits types + triage standard + project-specific). Uses `EndBug/label-sync@v2`. `delete-other-labels: false` by default so manually-added UI labels survive each run; the `workflow_dispatch` form exposes a boolean input to flip that to `true` for an occasional cleanup pass. |
| `pages.yml` | Push to `main` (paths: `api/openapi.yaml`, `docs/**`, `book/**`, `testdata/**`, `pages.yml` itself) + `workflow_dispatch` | Two artifacts: (1) the user-docs **book** built with Honkit from `book/` plus the eleven `docs/*.md` chapters (`install-{macos,linux,windows}`, `how-it-works`, `settings-reference`, `filtering`, `unknown-screenshots`, `server`, `docker`, `grafana`, `feedback`) staged in at build time, plus a `testdata/` mirror so the example-screenshot images in `how-it-works.md` resolve via the same relative path the README uses — lands at the Pages root <https://sound-barrier.github.io/recall/>; (2) the **Swagger UI** rendering of `api/openapi.yaml` at <https://sound-barrier.github.io/recall/api/>, linked from the book's sidebar. When adding a new chapter, update `book/SUMMARY.md`, the workflow's "Stage book build directory" cp list, AND the Makefile's `pages-build` target's cp list in lock-step. Honkit pin lives in the workflow's `HONKIT_VERSION` env. **One-time setup:** Repo Settings → Pages → Source = "GitHub Actions" (the workflow can't flip this itself; missing it surfaces as `Get Pages site failed`). |
| `release-please.yml` | Push to `main` | Reads Conventional Commits since the last tag, opens/updates a Release PR that bumps `.release-please-manifest.json` + regenerates `CHANGELOG.md`. Merging the PR creates a `vX.Y.Z` tag which fires `release.yml`. Override the computed version with a `Release-As: X.Y.Z[-suffix]` footer in any commit on `main` — useful for one-off prereleases (the hyphenated suffix is what makes GitHub flag the Release as prerelease). Shortcut: `make release-beta VERSION=…`. Full procedure in [RELEASES.md](RELEASES.md). **Authoring identity:** release-please is configured with a PAT (not `GITHUB_TOKEN`), so the PR is authored under the maintainer's account, not `github-actions[bot]`. That has two consequences: `pull_request` workflows (CI, pr-compliance, etc.) DO trigger on the release PR; and bot-login-based exemptions need a branch-name fallback (`startsWith(head.ref, 'release-please--')`) to recognise it. |
| `release.yml` | `v*` tags | Builds and publishes release artifacts — see detail below. |

### `release.yml` detail

Triggered on `v*` tags (push) and on `workflow_dispatch` (manual fallback for when release-please's `GITHUB_TOKEN`-authored tag failed to chain — `make release-fire TAG=…`). Parallel jobs: `build-docker` (Linux + Windows Wails apps + all server binaries via Docker; packages Linux binaries as `.tar.gz` and `.deb` installing to `/usr/local/bin/`), `build-mac` (macOS Wails arm64 `.app` bundle wrapped in a `.dmg` via `hdiutil`, requires Apple runner), `sbom` (generates `recall-{version}-sbom.spdx.json` via `anchore/sbom-action` — SPDX JSON covering Go modules + npm packages), `publish-container` (builds `server-container` stage and pushes to `ghcr.io/<owner>/recall-server`: every tag publishes the exact `:{{version}}`; rolling `:{{major}}.{{minor}}` and `:latest` only push on stable releases — prerelease tags (those with a hyphen, e.g. `v0.1.0-beta.0`) are guarded by `enable=${{ !contains(github.ref_name, '-') }}` so `docker pull recall-server:latest` always lands on a non-prerelease build. See [RELEASES.md](RELEASES.md) → "Stable vs. prerelease at a glance" for the full matrix. GHCR only, not attached to the release; attempts to set visibility to public via API with `continue-on-error` — `GITHUB_TOKEN` lacks the `write:packages` OAuth scope for visibility changes, so the package must be set public once manually via GitHub Package settings. **Image signing**: after push, every tag is signed with `sigstore/cosign-installer@v3` + `cosign sign --yes` using keyless OIDC — the workflow's GitHub Actions identity is the signing identity (no long-lived keys). Signing is by digest (`${tag%:*}@${DIGEST}`), not tag, so a tag re-point cannot accidentally invalidate the signature. Requires `id-token: write` on the publish-container job. Users verify with `cosign verify ghcr.io/sound-barrier/recall-server:<tag> --certificate-identity-regexp 'https://github.com/sound-barrier/recall/\.github/workflows/release\.yml@refs/tags/v.*' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'` — full recipe in [docs/docker.md](docs/docker.md) → "Verifying the image"), and `release` (waits on `build-docker` + `build-mac` + `sbom`; generates a per-artifact `<filename>.sha256` file for every binary and package — not for the SBOM; uploads all to GitHub Releases). All release artifacts embed the tag version in their filename: `recall-{version}-linux-amd64.tar.gz`, `recall-{version}-darwin-arm64.dmg`, etc. (`v` prefix stripped from the tag). GHCR auth uses `secrets.GITHUB_TOKEN` — no PAT needed; workflow permissions must include `packages: write`.

## Documentation audiences

| File(s) | Audience | Notes |
|---|---|---|
| `README.md`, `docs/install-{macos,linux,windows}.md` | Gamers | Quick start + per-platform install. Keep jargon out of these. |
| `docs/how-it-works.md` | Gamers | Pipeline overview + expected user workflow + the four screenshot types. Anchors the book's "Using Recall" section. |
| `docs/settings-reference.md` | Gamers | Every Settings + Ingest tab field documented (Directories / Appearance / Calendar / Engine / Parse / Export / Data). Source of truth for "what does this knob do?". |
| `docs/filtering.md` | Gamers | The Matches tab filter rail end-to-end: 7 multi-filter pills, search-inside-popover, date range, sort, Expand/Collapse, Min-play threshold, Undated toggle, Clear Filters, group rail. |
| `docs/unknown-screenshots.md` | Gamers | Unknown tab triage. Lists the 4 common causes of a record landing there, the field-diagnostic strip's columns, and the recover-via-recapture / re-parse / file-bug paths. |
| `docs/feedback.md` | Gamers | "How do I file a bug or feature request" — book chapter pointing at the two `.github/ISSUE_TEMPLATE/*.yml` forms + the security-advisory channel. |
| `docs/server.md`, `docs/docker.md`, `docs/grafana.md` | IT-savvy users | The README's "Advanced" section gates entry to these. |
| `CONTRIBUTING.md`, `RELEASES.md` | Developers | Build, lint, release, commit-message rules. |
| `CODE_OF_CONDUCT.md` | Everyone interacting with the repo | Two rules: be respectful, and respect that the project is given away free with no SLAs. Plain-spoken, deliberately short (~50 lines) — not the Contributor Covenant. Linked from README's Contributing section and the top of CONTRIBUTING.md. |
| `SECURITY.md` | Security researchers / would-be reporters | Vulnerability-disclosure policy: only the latest release is supported, file privately via GitHub Security Advisories (not public issues), no SLA on response time (matches CoC tone). Scope section enumerates in-scope code/surfaces and out-of-scope items (third-party CVEs go upstream; misconfiguration is the user's responsibility). GitHub auto-surfaces in the Security tab; CoC's "Reporting violations" now cross-refs this file. |
| `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/pull_request_template.md` | New issue / PR authors | YAML Issue Forms: **bug_report** (QA-style — version / OS / Tesseract / expected vs actual / steps / two screenshot fields split between "Overwatch screenshot that mis-parsed" and "Recall app or website screenshot" / logs) and **feature_request** (what / why / how-you'd-use-it / alternatives / scope guess / mockup), both labelled by `.github/labels.yml`'s `bug` + `enhancement` entries. `config.yml` disables blank issues and links to the docs site + the private security-advisory channel. PR template carries the commit-style + TDD + docs-update checklist plus two enforced attestations (CoC, Apache-2.0 license grant) that `pr-compliance.yml` grep-checks. Edit the template wording AND update the grep regex in `pr-compliance.yml` together — the two are coupled. `docs/feedback.md` in the book is the user-facing pointer to all three forms. |
| `.github/CODEOWNERS` | GitHub PR routing | Single catch-all rule (`* @jacob-delgado`) auto-requests a review from the maintainer on every PR. If branch protection ever turns on "Require review from Code Owners" the rule starts gating merges; until then it's just a routing hint. Add more specific patterns above the catch-all if scope gets divided in the future (last-matching-rule-wins). |
| `.github/labels.yml` | Issue / PR triagers | Declarative repo-label definitions (name, description, color). Three groups: Conventional Commits types (matches the commit-msg hook's allowed list), triage standard (`bug`, `enhancement`, `good first issue`, …), and project-specific (`a11y`, `security`, `breaking change`). Synced to GitHub by `labels.yml` workflow on every push that touches this file. The `bug` label the bug_report.yml issue template references becomes formally defined here — keep the two in sync if either changes. |
| `CLAUDE.md` | AI assistants | This file — AI assistant context. Not user-facing. |

Cross-doc anchors that are load-bearing: `docs/install-{macos,linux,windows}.md#verifying-your-download` (linked from README's Verifying section), `CONTRIBUTING.md#building` (linked from `install-linux.md`), `CONTRIBUTING.md#pre-commit-hooks-lefthook` (linked from README and RELEASES). Rename a heading and you'll silently break the inbound link.

## Conventions worth knowing

- **`frontend/node_modules/` no longer pollutes `go list ./...`** — the `flatted` npm package ships a stray `golang/pkg/flatted/flatted.go` that Go's package walker used to absorb into the recall module. `frontend/scripts/seed-go-sentinel.cjs` runs as an npm `postinstall` hook and drops a stub `frontend/node_modules/go.mod` so the walker stops at that boundary. After every `npm ci` the sentinel re-seeds automatically; `frontend/dist` is left in the recall module so `//go:embed all:frontend/dist` in `assets.go` still works. Belt-and-suspenders: `scripts/deadcode-check.sh` still pipes through `grep -v node_modules` and `make lint-gosec` still passes `-exclude-dir=frontend`, so a sentinel that gets accidentally deleted or never seeded (someone editing `node_modules/` by hand) keeps the rest of the project working. New whole-program Go tools should keep the filter as defence-in-depth.

- **`Dockerfile.build` frontend-builder runs `npm ci` BEFORE the full `frontend/` source is copied** — only `package.json`, `package-lock.json`, and `frontend/scripts/seed-go-sentinel.cjs` are in the layer at that point. The third file is required because `package.json`'s `postinstall` hook invokes it; without an explicit `COPY frontend/scripts/seed-go-sentinel.cjs ./scripts/seed-go-sentinel.cjs` line, npm ci dies with `Cannot find module '/frontend/scripts/seed-go-sentinel.cjs'` and every Docker build target breaks. Any new postinstall hook that references a project file needs the same up-front COPY.

- **Multi-line code in CLAUDE.md bullets trips markdownlint MD031.** A fenced ` ``` ` block indented under a `-` bullet violates "fenced code blocks should be surrounded by blank lines" — adding blank lines breaks the bullet's continuation, so neither shape works. Inline the command as a single backtick string instead (long lines are fine; markdownlint doesn't enforce line length in this repo). Reserve top-level fenced blocks for body prose, not bullet contents.

- **Headings containing em-dashes / non-ASCII trip markdownlint MD051.** Honkit's slugifier preserves the dash (`## 3. First launch — approve SmartScreen` → `id="3-first-launch-—-approve-smartscreen"`) but markdownlint's MD051 fragment validator strips it, producing a mismatch when you link to the anchor from elsewhere in the same doc via `[label](#3-first-launch-approve-smartscreen)`. Simplest workaround: don't link to such anchors by fragment — restructure the prose to reference the section by name ("see section 3 below") instead.

- **CI jobs in `ci.yml` use sequential numbered comments** (`# ── Job N: ...`). When inserting a new job between existing ones, renumber subsequent comments to keep the sequence contiguous.

- **`deadcode` always exits 0** — findings are printed to stdout but the exit code is never non-zero. To gate on findings in a Makefile or CI step, capture stdout and assert it's empty (or grep-filter expected stubs). See `make dead-code-go` for the pattern.

- **`TECHNICAL_DEBT.md` is delete-when-paid, not strikethrough-when-paid.** The file's own header states "delete the section ... git history is the audit trail". Don't add `Already paid down` log entries, `Phase N ✅ COMPLETE` subsections, or `~~item~~ — done` lines — just delete the closed item. Item numbers stay stable across deletions (gaps are fine; never renumber). The standing roadmap at the bottom lists only what's still open.

- **Pre-push hook runs `make cover`** — every `git push` reproduces the Go + Vitest coverage matrix (~3-5 s extra). The hook gates on the same thresholds CI does (`GO_COVERAGE_MIN` + `vitest.config.ts` `coverage.thresholds`), so a coverage regression fails the push before it hits the wire. Skip with `LEFTHOOK_EXCLUDE=coverage git push ...` only if you're sure CI will catch it.

- **deadcode known-good filter is centralised in `scripts/deadcode-allow.txt`.** `Makefile` `dead-code-go:`, `lefthook.yml` `pre-push.deadcode`, and `.github/workflows/ci.yml` "Dead Go code" step all shell out to `scripts/deadcode-check.sh`, which reads one regex fragment per line from `scripts/deadcode-allow.txt` and fails iff the filtered residual is non-empty. Adding a new intentional unreachable (build-tag stub, test-only constructor): append a line to the allow-list file. No need to touch the three callers.

- **Pinned tool versions live in `tool-versions.env` at the repo root.** Pinned keys: `SPECTRAL_VERSION`, `TYPOS_VERSION`, `GOSEC_VERSION`, `HONKIT_VERSION`. Consumers per syntax:
  - `Makefile` — `include tool-versions.env`
  - `lefthook.yml` — `. ./tool-versions.env` inside the run block
  - `.github/workflows/ci.yml` + `pages.yml` — `grep -E '^[A-Z_][A-Z0-9_]*=' tool-versions.env >> "$GITHUB_ENV"` (the grep filter is required — GitHub Actions' env-file validator rejects comment + blank lines that the file carries for the shell consumers)
  - `initialize.sh` + `.devcontainer/postCreate.sh` — `. tool-versions.env`

  `make check-deps` validates all four against upstream and also asserts the trailing `# vX.Y.Z` comment on the SHA-pinned `crate-ci/typos` action ref in `ci.yml` matches `$TYPOS_VERSION`. The other pinned tools (Wails CLI, hadolint, lefthook, trivy) are still duplicated between `initialize.sh` and `.devcontainer/postCreate.sh` but `make check-deps` covers them via direct file parsing. **Swagger UI image** (`Makefile` `SWAGGER_IMAGE`) is the only remaining pin not under any check.

- **`typos --force-exclude` is required when filenames are passed explicitly.** `_typos.toml`'s `extend-exclude` patterns apply during directory walks only. Lefthook's `typos` hook passes `{staged_files}` as positional args, which bypasses extend-exclude unless `--force-exclude` is set on the typos invocation. The hook in `lefthook.yml` runs `typos --force-exclude {staged_files}` for this reason — keep the flag whenever an iteration hands typos explicit file paths (otherwise binary files like `testdata/*.png` get scanned as text and deflate runs trip the dictionary).

- **Third-party GitHub Actions are SHA-pinned with a `# vX.Y.Z` comment** — `scripts/check-action-pins.sh` enforces it from `make lint-actions`, the lefthook `pre-push.actionlint` block, and the CI lint job. Tag-pinned refs are rejected. Pattern: `uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4` (two spaces before the `#` to satisfy yamllint). First-party composite actions (`./.github/actions/foo`) are exempt. Dependabot understands the SHA + comment format and bumps both fields together. Resolve a new SHA with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`. See CONTRIBUTING.md → "Pinning GitHub Actions" for the contributor-facing rules.

- **`npx vitest` / `npm run *` must run from `frontend/`.** Bash invocations start at repo root and Vite resolves `vitest.config.ts` from cwd, so running from elsewhere errors with a misleading "Install @vitejs/plugin-vue to handle .vue files" even though the plugin IS installed. Use `cd frontend && …` or `npm --prefix frontend run …`. The `make` targets (`make test-frontend`, `make cover-frontend`) handle cwd automatically.

- **This repo runs two test runners; each owns a disjoint file pattern.** Vitest reads `src/**/*.test.ts` (unit + composable + SFC tests via `mount()`). Playwright reads `frontend/tests/e2e/*.spec.ts` (real browser, axe-core a11y). Vitest's default discovery (`**/*.{test,spec}.ts`) WILL sweep in Playwright specs unless the include glob is pinned — loading a Playwright spec under Vitest crashes with `Playwright Test did not expect test.describe() to be called here`. Adding a new test runner (Cypress, contract tests, screenshot diff, …) means: pick a file extension or directory the existing runners don't claim, AND update `vitest.config.ts` `test.include` if needed to keep Vitest from picking it up.

- **Refs inside a prop-passed object don't auto-unwrap.** Vue templates auto-unwrap top-level refs but stop at object depth, so when bundling a composable's return as a single prop (the `CardStateApi`, `FiltersApi` pattern in MatchesView), consumers must use `.value` on the inner refs: `cardState.previewOpen.value[filename]`, not `cardState.previewOpen[filename]`. The TypeScript prop types should declare these as `Ref<X>` (not the unwrapped shape) so vue-tsc catches misuse.

- **`null` doesn't drop a Vue attribute the way you'd hope.** vue-tsc rejects `null` for boolean/Booleanish attrs (`:inert`, `:aria-hidden`, `:aria-pressed`). Use `undefined` to omit: `:inert="cond || undefined"`, `:aria-hidden="cond ? 'true' : undefined"`.

- **Use `:where()` for UA-default resets that must not compete with existing class rules.** Promoting a `<span class="badge">` to a `<button class="badge">` brings back UA `appearance`/`background`/`border`/`padding`/`font` defaults. Wrap the overrides in `:where(button.badge, ...) { appearance: none; background: transparent; ... }` so specificity stays 0 and the existing `.badge` / `.badge.active` styles continue to win. Pattern lives in `MatchCard.vue`'s scoped `<style>` block (the reset targets MatchCard's chip buttons; lifted out of `app.css` during the per-component extraction).

- **A clickable container that holds interactive chips cannot be `role="button"`.** Nesting interactive elements is invalid HTML and ARIA, and the outer `role="button"` strips keyboard reach from the inner chips. Pattern in MatchCard.vue: outer `<div class="match-header">` keeps `@click` for mouse convenience but has no role/tabindex; a dedicated `<button class="chev-btn" aria-expanded>` on the right is the keyboard expand affordance.

- **`mountApp` exports `fireEvent(name, data?)`** for tests that need to drive a captured `EventsOn` handler (e.g., simulating `parse-complete` from the watcher or `parse-progress` mid-flight). Pair with `await flushPromises()` when the handler is async (most are — they call `load()`). See the `scoreboard pulse` tests in `App.test.ts`.

- **happy-dom `document.activeElement` fails `.toBe(wrapper.find(...).element)`.** The two references serialize identically but the `.toBe` reference check fails (vitest reports "serializes to the same string"). Compare via `(document.activeElement as HTMLElement)?.id` or another attribute instead of element identity.

- **Lefthook's frontend hooks (eslint/stylelint) routinely skip with "no files for inspection"** even when `frontend/src/**` is staged. Don't rely on the hook — run `cd frontend && npx eslint 'src/**/*.{ts,vue}'` and `npx stylelint 'src/**/*.{vue,css}'` manually after frontend edits. The full `make lint` and CI both catch issues; only the local pre-commit hook is unreliable for the frontend root-scoped commands.

- **`httptest.NewRequest` + `NewRecorder` is the HTTP-handler test pattern.** Used in `pkg/cmd/server_test.go` (mux-level via the `get(t, mux, path)` / `post(t, mux, path, body)` helpers), `pkg/metrics/metrics_test.go` (collector), and `pkg/app/screenshot_handler_test.go` (single `http.Handler`). For App handlers, write the test in `package app` and mutate `a.settings.X` directly rather than calling `SetX` — the latter saves to the real on-disk `settings.json`. Gotcha: `httptest.NewRequest` parses+validates the URL at construction time and **panics** on malformed escapes like `%ZZ`. To exercise a handler's url.PathUnescape branch, build a syntactically-valid request first and then mutate `req.URL.Path` directly — the post-construction assignment skips re-validation. See `TestScreenshotHandler_RejectsMalformedURLEscape` for the exact recipe.

- **Outbound HTTP gets a `var url = "..."` seam, not an injected `*http.Client`.** `pkg/app/update.go` exposes `releasesURL` as a package-level var so `pkg/app/check_for_update_test.go` can swap it for an `httptest.NewServer` URL without touching the real GitHub API. Mirrors the function-variable-seam guidance for single-method dependencies (see `parser.runTesseractFunc`). Same shape works for any package-level test mutation — `withVersion(t, "0.1.0-dev")` in the same file swaps the ldflags-injected `Version` for the test's scope. Pattern is `prev := X; X = newVal; t.Cleanup(func() { X = prev })` — keeps parallel tests safe and never leaves global state mutated across files.

- **`pkg/cmd/server.go` single-method routes use `methodGuard(method, h)`** — a four-line preamble used to repeat across nine handlers. When adding a new REST route that answers only one verb, wrap the handler in `methodGuard(http.MethodGet, func(...) { ... })` rather than open-coding the 405 check. The three GET-or-POST endpoints (screenshots-dir, prometheus-enabled, watch-enabled) keep their explicit switch since they answer both verbs.

- **`docs/` is the source of truth for documentation chapters; `book/` is metadata only.** The Honkit-built docs site at <https://sound-barrier.github.io/recall/> renders `docs/install-macos.md`, `docs/install-linux.md`, `docs/server.md`, `docs/docker.md`, and `docs/grafana.md`. The Pages workflow and `make pages-build` both stage `book/` + the five chapter copies into a fresh `_stage/book/` (CI) or `dist/pages-stage/` (local) and run Honkit there, so `book/` stays pure metadata in git — only `book.json`, `SUMMARY.md`, `README.md`, and `.gitignore` are committed. To add a new chapter: drop the `.md` into `docs/`, add it to `book/SUMMARY.md`, and extend the `cp` step in both `.github/workflows/pages.yml` and the `pages-build` target in `Makefile`. Don't edit chapter content in `book/`; any file you put there gets ignored anyway (see Honkit-silent-failures bullet below).

- **Honkit fails silently in two ways that both produce a 1-page book** with no warning. (1) It reads `.gitignore` from its source dir and drops matching files — listing chapter filenames in `book/.gitignore` (e.g. to keep local previews from dirtying git) makes Honkit ignore them all. (2) It resolves `SUMMARY.md` chapter paths relative to `cwd`, not its source arg — `npx honkit build book book/_book` from repo root parses SUMMARY but can't find the chapters. Both symptoms look identical in the build log (`info: found 1 pages` instead of the expected count). The Pages workflow and `make pages-build` both work around this by staging into a fresh `_stage/book/` (CI) or `dist/pages-stage/` (local) and running honkit from inside it — `book/` stays pure metadata in git, no `.gitignore` conflict, the cwd is right. Don't "simplify" by running honkit against `book/` directly; you'll lose four out of five chapters silently.

- **Honkit asset-copies any non-markdown file in its source dir into the build output** while preserving the relative path. To embed images (or any binary asset) in a book chapter, drop them into a subdir under the staging dir — `make pages-build` + `pages.yml`'s "Stage book build directory" already do this for `testdata/*.png` via `mkdir -p _stage/book/testdata && cp testdata/*.png _stage/book/testdata/`. Reference from chapter md as `testdata/foo.png` (or whatever the subdir is) and the same path also works in GitHub-rendered markdown (`README.md`'s screenshot examples reuse the same paths), so a single image src string is valid in both surfaces — no absolute `raw.githubusercontent.com` URL needed. New asset-bearing chapter? Add the `mkdir -p` + `cp` lines in both pages.yml and the Makefile target, and remember to extend the `paths:` trigger if the asset dir is outside `docs/` / `book/`.

- **The macOS in-DMG `README.txt` lives at `docs/dmg/README.txt`** and is the single source of truth for the drag-install + Gatekeeper-approval steps; `scripts/release/make-dmg.sh` copies it into the DMG staging dir during release. `docs/install-macos.md` sections 2-3 mirror the same content for the web (slightly expanded with extras the in-DMG copy deliberately skips: the "what you'll see in the DMG" preamble in section 2, the `xattr -d com.apple.quarantine` Terminal alternative in section 3). Edit one of the pair, then check the other — an HTML comment at the top of the synced region in install-macos.md flags this. Previously the README.txt content lived as a heredoc in `release.yml`'s "Create DMG" step; that heredoc is now extracted, so the synced region is `docs/dmg/README.txt` ↔ `docs/install-macos.md`.

- **Release-time shell logic lives in `scripts/release/`**, not inline in `release.yml`: `package-linux.sh` (Linux/Windows/macOS-server artifact staging), `make-dmg.sh` (macOS DMG wrapping), `sign-image.sh` (cosign keyless), `flip-package-public.sh` (GHCR visibility), `compute-sha256.sh` (per-artifact sha256 sidecar files). Each script reads its inputs from env vars set in the corresponding workflow step. Adding a release-time step that's more than a trivial one-liner: drop a new `scripts/release/*.sh` and call it from `release.yml`. The Makefile's `SHELL_SCRIPTS` glob covers `scripts/release/*.sh` so `make lint-shell` (which CI runs) catches shellcheck / shfmt issues.

- **A workflow that "fails" doesn't block merge until it's marked as a required status check.** `pr-compliance.yml` fails the build when the PR description's CoC + license checkboxes aren't ticked, but the PR is still mergeable unless `PR Compliance / required-checkboxes` is added to Repo Settings → Branches → Branch protection rules → main → "Require status checks to pass before merging". Same shape as the `pages.yml` one-time-UI-setup ("Source = GitHub Actions") — invisible from inside the workflow, easy to forget when adding new merge-gating workflows. The `ci.yml` checks were promoted to required at repo setup time and have stayed required since; any new gate needs the same flip.

- **The a11y suite forces `prefers-reduced-motion: reduce` via `page.emulateMedia()` in a `beforeEach`.** Without it, axe-core's color-contrast check samples mid-animation alpha — the `view-fade-in` keyframes ramp opacity 0→1 over 360ms, and axe runs before that completes, so legible colors get reported as failing. Setting `use.reducedMotion: 'reduce'` in `playwright.config.ts` does NOT work as of Playwright 1.60: the project-level `use: { ...devices['Desktop Chrome'] }` shadows it, and re-asserting it inside the project still doesn't propagate. `page.emulateMedia()` in a `beforeEach` is the only reliable lever. Any new a11y spec must do the same — accessibility audits should run in reduced-motion mode so animations can't mask issues.

- **`--text-faint` luminance was bumped to clear WCAG 2 AA on `--surface-3`.** Night `#6b6f7a → #878a96` (5.02:1 on surface-2, 4.74:1 on surface-3, 5.97:1 on bg). Day `#6f6a5e → #6a655a` (5.20:1 on surface-2, 4.72:1 on surface-3). When introducing new "faint" or "muted" greys, compute contrast against ALL of `--surface-2`, `--surface-3`, AND `--bg` — small UI text (≤14px non-bold) needs 4.5:1 against every surface it might land on, and the project's surfaces vary by ~0.4% luminance which is enough to flip a borderline color across the threshold.

- **A11y patterns to mirror, not reinvent.** Modal dialogs: focus trap + Escape + return-focus + background `inert` is wired inline in App.vue (see `showUnsupportedModal` + `onModalKeydown` + the `watch(showUnsupportedModal, ...)`). Tablist: Arrow/Home/End automatic-activation in `onTabKeydown` over `TAB_ORDER`. Skip-link: `.skip-link` → `<main id="main-content" tabindex="-1">` with `focusMain` handler for browsers that don't move focus on hash navigation. Reduced-motion: a global `@media (prefers-reduced-motion: reduce)` block at the top of App.vue's styles collapses every animation/transition to 0.01ms. Tests for each in `App.test.ts`.

- **knip project scope is `src/**/*.{ts,vue}`.** `@eslint/js` must stay in `ignoreDependencies` in `frontend/knip.config.ts`: typescript-eslint consumes it internally but doesn't ES-import it, so knip can't detect the usage. `@vitest/coverage-v8` does NOT need `ignoreDependencies` — vitest detects it via `coverage.provider: 'v8'` in `vitest.config.ts`. Run via `make dead-code-ts` or `cd frontend && npm run dead:ts`.

- **TypeScript 6.x is blocked by `openapi-typescript`.** `openapi-typescript@7.x` declares `peer typescript: "^5.x"` and will cause `npm install` to fail with an `ERESOLVE` conflict if `typescript` is bumped to `^6.x`. Hold TypeScript at `^5.x` until `openapi-typescript` ships TS 6 support.

- **`stylelint-config-standard` rejects BEM `--` modifiers** — `selector-class-pattern` only allows kebab-case, so `.foo--modifier` is invalid in `App.vue`. Use `.foo-modifier` instead for CSS class variants. Also require an empty line before every rule block (`rule-empty-line-before`), including `:hover` pseudo-selectors that follow a closing `}`. These are **errors**, not warnings — they fail `make lint` (`make: *** [lint-css] Error 2`). Most stylelint errors here (`value-keyword-case`, `rule-empty-line-before`, `comment-empty-line-before`) are autofixable: `cd frontend && npx stylelint --fix "src/**/*.{css,vue}"`.

- **Adding a field to an existing Go struct** is a 2-step follow-up now: (1) update the struct + OpenAPI schema, (2) `make gen-types` to refresh `api.gen.d.ts`. `frontend/wailsjs/` is gitignored and regenerated by `wails build` at desktop-build time, so the old "edit `wailsjs/go/models.ts` by hand" step is gone. `api.ts` consumes the OpenAPI-generated types in `api.gen.d.ts` for both transport paths (Wails delegate + server-mode fetch), so the contract lives in one place. Devs who only run server mode (devcontainer, headless boxes) stay in sync without ever touching `wailsjs/`.

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

- **`pkg/parser/heroes.yaml` + `pkg/parser/maps.yaml` are the source of truth for the OW roster.** Both files are embedded into the parser binary at compile time (`//go:embed` in `pkg/parser/owdata.go`) and parsed at `init()` time into `parser.HeroesByRole` + `parser.MapsByType` (canonical display data, role/type → ordered name slice) plus the lowercase-normalized lookup tables `heroRoles` / `mapTypes` / `heroDisplayNames` / `mapDisplayNames` / `knownMaps` the OCR matcher and the parser internals use. Adding a hero or renaming a map: edit the YAML, rebuild — no Go-source edit needed. The `normalize()` function in `owdata.go` is the canonical key derivation (lowercase + diacritic-strip + colon-strip + whitespace-collapse); any new YAML name with diacritics ("Lúcio", "Esperança") or colons ("Soldier: 76", "Watchpoint: Gibraltar") folds correctly. Two consumer surfaces beyond the parser itself: (a) `pkg/app/owdata.go::App.GetOWData()` returns the data over the Wails bridge / `/api/owdata` HTTP route, and (b) `frontend/src/composables/useOWData.ts` is a module-singleton that fetches once per session and exposes `heroDisplayName(stored)` / `mapDisplayName(stored)` for UI surfaces that render the canonical Blizzard spelling while filter logic + match_key derivation keep using the normalized lowercase stored form. **Adding a hero that overlaps with common BattleTag substrings** (the way "Mizuki" can shadow "Mei" in OCR text containing player tags) is a known false-positive vector — the longest-substring-wins iteration in `extractHeroes` favours the longer match. Consider whether a new hero's name might appear as a substring in scoreboards before adding it; running `make update-goldens RECALL_FIXTURE_DIR="$PWD/testdata"` after a YAML change surfaces collisions immediately when the goldens flip.
- **Frontend imports from `'./api'`** (resolves to `frontend/src/api.ts`). `api.ts` is a transport-agnostic shim typed against the OpenAPI spec via `api.gen.d.ts` (regenerated by `make gen-types`): in Wails mode it delegates to `window['go']['app']['App']`; in browser/server mode it uses `fetch('/api/...')` and `EventSource('/api/events')`. Adding a new exported method on `App` is a **three-step** process:
  1. Add the method to the appropriate `pkg/app/*.go` file (file-per-concern split — `tesseract.go`, `watcher.go`, `match_record.go`, etc.).
  2. Add the route + schema to `api/openapi.yaml` and run `make gen-types` to refresh `api.gen.d.ts`.
  3. Add the typed wrapper to `frontend/src/api.ts` — both the Wails delegation path (`window.go.app.App…`) and the `fetch` path.

  Skipping step 3 silently breaks server mode while Wails mode continues to work. The Wails bindings (`frontend/wailsjs/`) are gitignored and regenerated by `wails build` automatically — no manual step.
- **The `_screenshot/<filename>` URL prefix** is reserved for the
  on-disk screenshots handler. Don't reuse it for other dynamic assets.
- **HTTP array responses initialize to `make([]T, 0)`, never `var x []T`.**
  A nil slice JSON-marshals to `null`, which violates any OpenAPI
  `type: array` declaration and fails schemathesis's
  `response_schema_conformance` check in CI. `readAllRecords` in
  `readAllRecords` in `pkg/app/match_record.go` is the canonical example. Same rule for any new
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
  by helpers in `pkg/app/inference.go` (`inferSoleHeroPercent`,
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
- **Bundle-size budget is enforced in CI.** Four limits in `ci.yml` step "Enforce bundle-size budget": initial JS chunk < 130 KB, initial CSS chunk < 80 KB, total assets/ JS < 250 KB, total CSS < 120 KB. The four view components (Matches, Ingest, Settings, Unknown) are lazy-loaded via `defineAsyncComponent` in App.vue so each emits its own Vite chunk and only the masthead/router-shell code counts toward the initial budget — `App.lazy-views.test.ts` is the regression guard against a refactor that converts a view back to a static `import`. Bump the budgets explicitly when a real feature needs the room — current state: ~103 KB initial JS / ~65 KB initial CSS / ~165 KB total JS / ~80 KB total CSS.
- **Vue 3 ref auto-unwrapping in templates** — in `<script setup>`, refs
  are auto-unwrapped at the template top level: `myRef` in a template
  expression already equals `myRef.value`. Writing `myRef.value[key]` in a
  template therefore double-unwraps and returns `undefined` silently.
  Always access `.value` inside a wrapper function in TypeScript, then call the
  function from the template.
- **User-controlled paths from HTTP go through a boundary validator
  before reaching `exec.Command` / `os.Stat`.** `validateScreenshotsDir`
  in `pkg/app/screenshots_dir.go` and `validateTesseractPath` in
  `pkg/app/tesseract.go` are the canonical
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
  that constrains path strings must allow `()` or it'll reject the
  Windows default out of the box (one of the test cycles spent
  tracking this down — don't repeat).
- **`gh workflow run --ref TAG` reads the workflow definition from
  that ref.** A `workflow_dispatch:` trigger added later on `main`
  is invisible to tags cut before the trigger landed — those refs
  can't be fired manually, only re-pushed (destructive). Current
  cutoff: `workflow_dispatch:` exists in `release.yml` from
  `v0.0.12-beta.0` onward. [RELEASES.md](RELEASES.md) →
  "When `release.yml` doesn't auto-fire" has the full procedure.
- **NSIS installer** — `wails build -nsis` requires the `nsis` apt package in the Docker `windows-builder` stage so `makensis` is on PATH. `VIProductVersion` in `project.nsi` must be numeric `x.x.x.x`; strip pre-release suffix before injecting into `wails.json` (`0.0.10-beta.0` → `0.0.10` via `grep -oE '^[0-9]+\.[0-9]+\.[0-9]+'`, fallback `0.0.0` for `dev`). Output: `build/bin/${INFO_PROJECTNAME}-${ARCH}-installer.exe` (e.g. `Recall-amd64-installer.exe`). Default install path uses `$PROGRAMFILES64\${INFO_PRODUCTNAME}` (no company-name subfolder).
- **Build provenance attestation** — `actions/attest-build-provenance@v2` requires `id-token: write` + `attestations: write` at the job level. Attest packaged artifacts (binaries) in the build jobs and sha256 files in the release job so the checksum verification chain is also signed. Users verify with `gh attestation verify <file> --repo sound-barrier/recall`. Does NOT replace Windows Authenticode — SmartScreen still warns without an EV certificate.
- **cosign keyless image signing** — every GHCR tag pushed by `publish-container` is signed by `cosign sign --yes "${tag%:*}@${DIGEST}"`.
  - **Sign by digest, not tag** — a tag re-point would otherwise silently break verification.
  - **Keyless OIDC** — the workflow's GitHub Actions identity IS the signing identity (no Sigstore key material to manage). Requires `id-token: write` on the job.
  - **User verification** — `cosign verify ghcr.io/sound-barrier/recall-server:<tag> --certificate-identity-regexp 'https://github.com/sound-barrier/recall/\.github/workflows/release\.yml@refs/tags/v.*' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'` (full recipe in [docs/docker.md](docs/docker.md) → "Verifying the image").
  - **Complements** (does NOT replace) build-provenance attestation: provenance proves "built by this workflow," cosign proves "the image bits weren't tampered with after upload."
  - Cosign pin lives in release.yml (`cosign-release: 'v2.4.1'`).
- **`# hadolint ignore=DL4006`** — add above any Dockerfile `RUN` that contains a shell pipe (`|`); same pattern as the existing `# hadolint ignore=DL3008` used for unpinned apt packages.
- **Quote every hex color in `.github/labels.yml`.** YAML 1.1 (which most parsers including EndBug/label-sync use) parses unquoted hex like `5319e7` as scientific notation (`5319 × 10^7`) and `008672` as an octal-style integer losing the leading zeros. Both fail label-sync's `color should be a string` validation. Always write `color: "008672"` — the quotes force string parsing regardless of what the hex digits happen to spell. Header comment in `labels.yml` calls this out for future editors.
- **`actions/setup-go@v6` sets `GOTOOLCHAIN=local` on the runner** as a determinism guard, and that env var is inherited by every subsequent docker-based step (the runner passes its env into containers by default). Combined with this project's `go 1.26.x` directive in `go.mod`, any docker action whose bundled Go is older than 1.26 fails with `go: go.mod requires go >= 1.26.x (running go 1.23.x; GOTOOLCHAIN=local)`. Three fixes ranked by reliability: (a) install the tool via `go install …@vX.Y.Z` to use the runner's setup-go install (what the gosec job now does); (b) skip setup-go entirely for jobs that only call docker actions; (c) override with `env: GOTOOLCHAIN: auto` on the step. The first is what we do everywhere now — keep it that way.
- **Any CI job that loads the root `main` package must first satisfy `//go:embed all:frontend/dist`.** `assets.go` embeds the Vite build output; on a fresh runner `frontend/dist/` doesn't exist and `go build` / `go list` / `gosec` / any other Go-source-loader fails with `pattern all:frontend/dist: no matching files found`. Use the `.github/actions/prepare-frontend-dist` composite action with `real-assets: 'true'` (real Vite bundle, ~30s — for e2e, coverage, bundle-size jobs) or `real-assets: 'false'` (cheap stub — for gosec, deadcode, CodeQL Go analysis). Ad-hoc inline `mkdir -p frontend/dist` or `cd frontend && npm ci && npm run build` invocations are forbidden — every new Go-loading job calls the composite.
- **release-please / dependabot / web-UI-merge commit identity comes from the GitHub account's primary email, NOT from anything in the repo.** `release-please-config.json` has no committer field; `dependabot.yml` has no committer field; the action workflows have no committer field. release-please commits via the GitHub API using whichever account's token authorized it (`secrets.RELEASE_PLEASE_TOKEN` PAT here — falls back to `GITHUB_TOKEN`), and the API uses that account's primary email. Dependabot merges and "Merge pull request" UI clicks similarly stamp the merger's account primary email. So: when bot commits show the wrong email, change github.com → Settings → Emails → "Primary email address" (and re-verify the desired address there if needed). No repo edits will fix it.
