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
| `make cover` / `cover-go` / `cover-frontend` | **Unit** coverage → `coverage/go/` + `frontend/coverage/`. Go fails below `GO_COVERAGE_MIN`; frontend below `vitest.config.ts` `coverage.thresholds`. |
| `make cover-e2e` | **Integration** coverage from one Playwright run → `coverage/e2e/` (`go/` + `frontend/`). Builds an instrumented frontend (`E2E_COVERAGE=1` inline maps) + server (`go build -cover`); Go counters flush on the server's graceful SIGTERM shutdown, frontend V8 coverage is remapped to source by monocart (Chromium only). Informational — no floor gate; kept out of the `cover` umbrella so pre-push stays fast. |
| `make test-e2e` | Playwright. Builds frontend + `serveronly` into `/tmp/recall-e2e/recall-server`, installs Chromium + WebKit, runs with `HOME=/tmp/recall-e2e` on `127.0.0.1:7099`. |
| `make test-all` | `make test` + `make test-e2e`. |
| `make gen-types` | Regenerate `frontend/src/api.gen.d.ts` from `api/openapi.yaml`. |
| `make typecheck` | `vue-tsc --noEmit`. `allowJs: false` blocks JS introduction. |
| `make update-goldens` | Regenerate parser golden sidecars (or set `RECALL_FIXTURE_UPDATE=1`). |
| `make goldens SRC=<file-or-dir>` | Generate parser goldens for any screenshot file or folder (not just `testdata/`) to eyeball what the parser extracts and spot bugs. Wraps `scripts/gen-goldens.sh`; isolates a single file so it doesn't touch siblings. |
| `make seed-dev N=300 PROFILE=demo [SEED=time] [FORCE=1] [CHAOS=0.15] [STYLE=…]` | Populate a SQLite profile with N synthetic matches via `cmd/seed-dev`. Refuses non-empty profiles unless `FORCE=1` wipes first. `SEED=time` is a sentinel that substitutes the current Unix timestamp for a fresh shuffle. `CHAOS=<0..1>` mixes pathological data shapes into that fraction of matches. `STYLE=` defaults to `flex` (covers every map + hero); also accepts `one-trick`, `one-role`, or `random`. See "Manual testing with a seeded corpus" below. |
| `make seed-clear PROFILE=demo` | Wipe a SQLite profile without re-seeding. No-op (and exits 0) when the profile is already empty. |

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

## Reference-data publishing surface

The parser ships three YAMLs (`heroes.yaml`, `maps.yaml`,
`screenshot_sources.yaml`) on two parallel channels:

| Channel | Producer | Consumer entry point | URL shape |
|---|---|---|---|
| **Release-bundled** | `.github/workflows/release.yml` (`recall-<version>-{file}.yaml` + `.sha256` + SLSA attestation) | `pkg/app/update.go::fetchReleaseRosters` | `https://github.com/sound-barrier/recall/releases/download/v<v>/recall-<v>-<file>` |
| **Live from main** | `.github/workflows/pages.yml` (re-deploys on every push that touches `pkg/parser/*.yaml`) | `pkg/app/update.go::fetchMainRosters` | `https://sound-barrier.github.io/recall/data/<file>` (+ `<file>.sha256`, + `version.json`) |

Both feed `pkg/app/apply_data_update.go::commitVerifiedAssets` which
SHA-256-verifies, atomically writes under `<RECALL_DATA_DIR>/data/`,
triggers `parser.Reload()`, and updates `manifest.json`. Adding a new
YAML file to the bundle takes a path-filter edit in `pages.yml` + a
stage step + an entry in `dataYAMLFiles` (`apply_data_update.go`). The
file shape — same SHA-256 sidecar format the existing `verifySha256`
reads — stays identical across channels so the consumer code branches
only on URL.

## Environment variable overrides (all optional, mainly for debugging)

| Var | Default | Effect |
|---|---|---|
| `RECALL_DATA_DIR` | platform user-config dir | Install-wide base directory. Each profile gets `<base>/profiles/<name>/{settings.json,db/recall.db}`. The repo's `.envrc` sets this to `$PWD/data`. |
| `RECALL_PROFILE` | *(unset — script-only)* | Forces `scripts/db/db-*.sh` to operate on a specific profile. Mirrors the app's `--profile=<name>` CLI flag. Not read by the app binaries. |
| `RECALL_DEBUG_DIR` | system temp | Directory for Tesseract work files; also dumps raw Tesseract `.txt` output per OCR call when set. |
| `RECALL_METRICS_ADDR` | `:9091` | Override Prometheus metrics bind address. |
| `RECALL_SERVER_ADDR` | `127.0.0.1:7000` | Override the HTTP server bind address. Set to `0.0.0.0:7000` inside Docker. |
| `DOCKER` | `docker` | Container runtime binary for `make build-*`. Set to `podman` for Podman. |
| `RECALL_PPROF` | *(off)* | Mounts `net/http/pprof` under `/debug/pprof/` in server mode. Never expose publicly. |
| `RECALL_FIXTURE_DIR` | `../../testdata` (from `pkg/parser/`) | `.png` fixture dir for `TestParseScreenshot_GoldenFiles`. Override with an ABSOLUTE path. |

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
| `deadcode-check.sh` | Runs `deadcode` against `serveronly`, filters via `scripts/ci/deadcode-allow.txt`, fails on non-empty residual. |
| `render-pr-report.py` | Renders the markdown PR report from CI artifacts. |
| `audit-bundle.sh` | Top-N (default 20) Vite chunks by size + JS/CSS totals. Snapshot tool, not a gate — informs lazy-load decisions. Pair with the size gate in `check-bundle-size.sh`. |
| `check-bundle-size.sh` | Per-chunk + total JS/CSS budgets. Runs on every CI push + lefthook pre-push; fails non-zero when a chunk exceeds its budget. |

## Bundle audit cadence

`make bundle-audit` runs `scripts/ci/audit-bundle.sh`. Use it when:

1. A `check-bundle-size.sh` gate is about to trip — find the offending chunk before bumping the budget.
2. Adding a new view / modal / heavyweight composable — confirm it landed in its own chunk if you lazy-loaded it via `defineAsyncComponent`.
3. As a periodic check (~once per release cycle, or when the Matches tab feels noticeably heavier on cold start).

The audit is read-only; it doesn't gate CI. The gate is `check-bundle-size.sh`. If the audit shows a single chunk dominating the budget, treat that as the candidate for extraction — cross-reference `App.lazy-views.test.ts` / `MatchesView.lazy-views.test.ts` so a future refactor can't silently undo the win.

## Manual testing with a seeded corpus

When eyeballing the UI against a large match set — dossier widgets, the
Campaign Log + Geography bands, infinite-scroll virtualization, sort/group with
hundreds of rows — parsing real screenshots is too slow. Use `make seed-dev` to write
synthetic rows straight into a profile's SQLite DB.

### One-time setup

`.envrc` already pins `RECALL_DATA_DIR=$PWD/data`. With `direnv allow`'d, every
`make dev` / `make seed-dev` invocation reads + writes under `<repo>/data/`,
never under `~/Library/Application Support/Recall/`. Real installs stay
untouched.

### `make dev` does NOT re-seed

`make dev` only starts the Wails dev server (Vite `:5173`, Wails IPC `:34115`).
It never touches the DB. To change the seeded corpus you must re-run
`seed-dev` explicitly. Hot-reload covers code changes; the DB is the source
of truth and persists across dev-server restarts.

### Workflow

```sh
# Seed a fresh profile (creates "demo" if missing).
make seed-dev N=300 PROFILE=demo

# Boot the app, switch to the demo profile via the masthead chip,
# then scroll Matches / inspect widgets / try sort + group.
make dev
```

### Re-seeding and wiping

```sh
# A non-empty profile refuses on purpose:
make seed-dev N=300 PROFILE=demo
# seed-dev: profile "demo" already contains 893 rows;
# pass --force to wipe and reseed (or --clear to wipe without re-seeding)

# Reseed in place (wipes first):
make seed-dev N=300 PROFILE=demo FORCE=1

# Wipe without re-seeding:
make seed-clear PROFILE=demo

# Fresh shuffle every run (seed = current Unix timestamp):
make seed-dev N=300 PROFILE=demo FORCE=1 SEED=time
```

### Flags + defaults

| Make var | Underlying flag | Default | Purpose |
|---|---|---|---|
| `N` | `--n` | `500` | Number of matches. Each match writes 1 Summary + 1 Teams, ~60% also write a Personal, ~40% a Rank — mirrors the mixed-coverage shape real parses produce. Default sized so the full canonical pool (51 heroes × 31 maps) gets enough natural appearances on top of coverage-pass cameos to read densely in the dossier. |
| `PROFILE` | `--profile` | `demo` | Target profile name. Created if missing. Pass the active profile name to seed your in-use profile (think twice). |
| `SEED` | `--seed` | `1` | Deterministic RNG seed — same `(N, SEED)` → byte-identical rows. Pass `SEED=time` for a different shuffle every run (Makefile substitutes `$(shell date +%s)`). |
| `FORCE` | `--force` | *(unset)* | Wipes every row in the target profile before seeding. Without it, a non-empty profile is a hard error. |
| `CHAOS` | `--chaos` | `0` | Fraction of matches (0..1) to receive pathological data shapes. `0` = clean corpus; `0.15` = ~15% of matches carry weirdness. See "Chaos seeding" below. |
| `seed-clear` target | `--clear` | *(target only)* | Wipe-and-exit, no seeding. Idempotent on already-empty profiles. |

### What the corpus looks like

The distribution is tuned to read as one player's season, not a uniform spray:

- **Dates** are sampled over `[2026-01-01, 2026-06-03]` with per-day activity
  weights — ~40% of days are inactive, the rest get a long tail of small
  to medium counts, plus the occasional marathon day. Sessions form
  naturally because the per-day count varies wildly.
- **Time of day** weights toward evening (peak 19-21h) but rolls morning,
  afternoon, and late-night samples too. Some days are an evening session,
  others a noon session.
- **Maps** are top-heavy — per-seed shuffled order + exponential decay
  weights (factor 0.75). With the full 31-map canonical pool the top
  map carries ~25% of the corpus and the tail tapers to under 1%.
  Every map is still guaranteed to appear at least once (see coverage
  pass below) so UI eyeballing sees every map label / icon. The pool
  itself derives from `pkg/parser/maps.yaml` at `init()` time — adding
  a new OW map to the YAML auto-populates the fixture without
  touching `pkg/app/fixtures.go`.
- **Hero pool** derives from `pkg/parser/heroes.yaml` (51 heroes — 14 tank, 14 support, 23 DPS), normalized to the same lower-case keys the real parser writes to `data.hero`. New patch heroes auto-populate when the YAML is updated.
- **Heroes** follow the `STYLE` flag:
  - **`flex`** (default): 2–3 main heroes **per role** (6–9 mains
    total), plus 10% off-main experiments. A flex-only coverage pass
    forces any missing pool hero into a random match so every hero
    icon renders. Designed for default eyeball UI testing.
  - **`one-trick`**: 95% the same hero, occasional experiments in their
    main role. No coverage forcing.
  - **`one-role`**: mostly main-role heroes with same-hero streaks,
    15% off-role experiments. No coverage forcing.
  - **`random`**: per-seed RNG picks one of the three styles (20% /
    30% / 50%). Preserved for multi-seed sweeps that want variety.
- **Results** weight to ~49.5% wins, ~49.5% losses, ~1% draws — a real
  player's W/L split, not the 33/33/33 a uniform pick produces.
- **Reviews** land on ~1.5% of matches (≈70% `self`, ≈30% `coach`).
  Use this to exercise the dossier's "days since last review" tile +
  the reviewed-by filter without manually clicking through 300 matches.

The default `STYLE=flex` is the right pick for "I want one corpus that
exercises every dossier widget, every map icon, every hero icon."
Switch styles only when you specifically want to test a one-trick or
one-role read of the UI:

```sh
make seed-dev N=300 PROFILE=onetrick FORCE=1 STYLE=one-trick
```

Use `STYLE=random` + multi-seed sweeps to spread across all three.

### Where the fixture lives

`pkg/app/fixtures.go` exports `GenerateMatchFixture(n, seed)` returning four
slices — `[]db.SummaryRow`, `[]db.TeamsRow`, `[]db.PersonalRow`,
`[]db.RankRow`. `cmd/seed-dev/main.go` loops them into the matching
`store.Upsert*` calls. The same generator is reusable from tests
(`pkg/app/fixtures_test.go` round-trips it through `dbtest.Fake`) so the
fixture shape never needs to be duplicated. The date range, play-style
probabilities, and hour weights are package consts at the top of
`fixtures.go` — adjust there.

### What's deliberately missing

- **No screenshot files on disk.** The UI shows "no preview" for these rows;
  fine for layout / aggregation / dossier work, not for testing the screenshot
  lightbox or source-file UI. Parse a real folder for those.
- **No ambiguous / unmatched rows.** Every match gets a tracked
  `match-<timestamp>` key. The Unknown tab will be empty.
- **No annotations / hidden flags / reviews.** Use the app to set those once
  you've seeded.

## Chaos seeding (edge-case resilience)

`make seed-dev` accepts a `CHAOS=<0..1>` fraction that mixes pathological
data shapes into that share of matches. The intent is exploratory: seed
a corpus with weirdness sprinkled through it, click around the UI, see
what breaks. `CHAOS=0.15` (~15% of matches) is a good starting point —
enough to surface bugs without making the whole profile unusable.

```sh
make seed-dev N=300 PROFILE=chaos FORCE=1 CHAOS=0.15
make dev    # switch to "chaos" profile, eyeball the UI
```

### What the chaos categories probe

Each chaotic match picks 1–2 shapes uniformly from these six:

| Category | What it does | What it surfaces |
|---|---|---|
| **long-strings** | Hero name = 200 chars, map name = 150 chars | Frontend truncation, sort comparators, dossier widget label space |
| **unicode** | Emojis + zalgo prefix on map / hero | URL encoding, axe-core a11y readouts, font fallback |
| **numeric-extreme** | EAD into the millions, negative healing, billion-scale damage | Integer overflow in dossier sums, K/D division-by-zero, chart Y-axis blowout |
| **cardinality** | 50 `HeroesPlayed` entries, 200 `HeroStat` rows on teams | Frontend list rendering, `aggregateAll` fold cost |
| **date-extreme** | Date = `1970-01-01`, `2099-12-31`, or malformed (`"yesterday"`) | Date-range filter, Campaign Log scale, calendar boundaries |
| **aggregation-conflict** | 1–2 extra summary rows sharing the original's `match_key` but with different `map` / `hero` / `result` | `mergeMatchResult` fold under contradictory inputs — which value wins? Is it deterministic? |

The chaos RNG is seeded from `seed + 1` so toggling `CHAOS` doesn't shift
the underlying corpus's heroes / maps / dates. Same seed → same "season,"
just with more or less weirdness layered in.

### Querying the seeded chaos

`sqlite3 data/profiles/chaos/db/recall.db`:

```sql
-- Aggregation-conflict rows (multiple summaries per match_key)
SELECT match_key, COUNT(*) FROM summary_screenshots
  GROUP BY match_key HAVING COUNT(*) > 1;

-- Long-string victims
SELECT match_key, length(hero) FROM summary_screenshots WHERE length(hero) > 100;

-- Date-extreme rows
SELECT match_key, date FROM summary_screenshots
  WHERE date IN ('1970-01-01','2099-12-31','yesterday');
```

### What chaos seeding is NOT

- **Not a regression gate.** Use it to find bugs, not to lock in behavior.
  The chaos categories are deliberately broad and will evolve.
- **Not a fuzzer for the parser** — the data goes through `store.Upsert*`
  directly, bypassing `parser.MatchResult` classification + `resolveMatchKey`.
  To probe those, hand-craft inputs and feed them through `App.insertParsed`.
- **Not a HTTP-surface stress** — the chaos lives in the DB. Server-mode
  resilience (URL encoding, body size, concurrent reads/writes) is a
  separate concern not covered here.

## Quick local exploration

For a throwaway probe outside the test runner, an `x*_test.go` in `pkg/app/` that
imports `recall/pkg/app` directly and calls `app.Startup` +
`app.ParseScreenshots` works — delete the file when done so it doesn't accumulate.
