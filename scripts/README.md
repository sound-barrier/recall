# scripts/

Helper scripts for running, inspecting, and maintaining Recall, organised
by concern:

- **`lib/`** — shared bash libraries (sourced, not run directly).
- **`db/`** — local SQLite inspection + maintenance.
- **`ci/`** — quality gates run by Make / lefthook / CI.
- **`stack/`** — the Prometheus + Grafana observability stack.
- **`release/`** — release packaging + signing.
- **`windows/`** — file-ops maintenance for Windows desktop users
  (PowerShell + double-clickable `.cmd`, no dependencies). See
  [`windows/README.md`](windows/README.md).

The bash scripts are safe to re-run from any working directory — they
resolve paths relative to their own location.

| Script | Purpose |
|---|---|
| [`stack-up.sh`](#stack-upsh) | Start the Prometheus + Grafana stack (starts Podman VM, syncs clock, runs compose up). |
| [`stack-down.sh`](#stack-downsh) | Stop the stack; pass `--machine` to also stop the Podman VM. |
| [`prometheus-clear.sh`](#prometheus-clearsh) | Wipe Prometheus's TSDB volume and restart clean; Grafana state is untouched. |
| [`verify-stack.sh`](#verify-stacksh) | Read-only layer-by-layer diagnostic: SQLite → /metrics → containers → scrape state → TSDB. |
| [`db-where.sh`](#db-wheresh) | Print the platform-canonical DB path (or `RECALL_DB` override). |
| [`db-list.sh`](#db-listsh) | One-line summary of every match with a per-type coverage chip. |
| [`db-show.sh`](#db-showsh) | Dump every per-screenshot-type row contributing to one match, children attached. |
| [`db-stats.sh`](#db-statssh) | Per-table row counts + coverage histogram (matches by # of contributing types). |
| [`db-orphans.sh`](#db-orphanssh) | List matches present in only one parent table — re-capture candidates. |
| [`db-delete.sh`](#db-deletesh) | Delete one match across all 5 parent tables (children CASCADE). |
| [`db-reparse.sh`](#db-reparsesh) | Drop one match's rows so the next Parse re-OCRs the PNG files fresh. |
| [`db-export.sh`](#db-exportsh) | Dump every match as newline-delimited JSON (per-type rows preserved). |
| [`clear-db.sh`](#clear-dbsh) | Wipe every parent table + VACUUM; equivalent to the UI's Clear Database button. |
| [`check-deps.sh`](#check-depssh) | Compare pinned tool versions (Wails, hadolint, lefthook, trivy) against latest GitHub releases. |
| [`_lib.sh`](#_libsh) | Internal library sourced by `stack-up.sh` and `prometheus-clear.sh`; not run directly. |
| [`_db.sh`](#_dbsh) | Internal library sourced by `db-*.sh` (DB-path resolution + schema-version detection); not run directly. |

---

## Observability stack

These scripts manage the Prometheus + Grafana stack defined in
`docker-compose.yml`. They use `podman-compose` by default; set
`DOCKER=docker` in your environment (e.g. via mise.toml `[env]`) to swap
the runtime.

### `stack-up.sh`

Start the Prometheus + Grafana stack.

```sh
bash scripts/stack/stack-up.sh
```

- Starts the Podman VM if it is not already running
- Slams the VM clock to host UTC time (guards against the ~77 s NTP
  drift that some Podman machine images ship with)
- Applies the `docker_config_aside` workaround if `docker-credential-gcloud`
  is referenced in `~/.docker/config.json` but is no longer on PATH
- Runs `podman-compose up -d` and prints the running service URLs

After the stack is up:

| Service    | URL                              |
|------------|----------------------------------|
| Prometheus | <http://localhost:9090>          |
| Grafana    | <http://localhost:3000> (admin / admin) |

### `stack-down.sh`

Stop the stack. Container volumes are preserved so history survives the
next `stack-up.sh`.

```sh
bash scripts/stack/stack-down.sh             # stop containers, leave VM running
bash scripts/stack/stack-down.sh --machine   # also stop the Podman VM
```

### `prometheus-clear.sh`

Wipe Prometheus's TSDB volume and restart with a clean slate. Grafana
state (dashboards, datasource config) is untouched.

```sh
bash scripts/stack/prometheus-clear.sh
```

Prompts for confirmation before deleting. Use this when you have
accumulated noisy or wrongly-timestamped samples during testing.

### `verify-stack.sh`

Read-only layer-by-layer diagnostic. Run this first whenever Grafana
shows no data.

```sh
bash scripts/stack/verify-stack.sh
```

Checks in order:

1. SQLite — can the DB be read and does it have rows?
2. `/metrics` endpoint — is the Recall app exposing Prometheus metrics?
3. Podman containers — are the stack containers running?
4. Prometheus scrape state — is Prometheus reaching the app?
5. TSDB sample count — has Prometheus actually ingested data?

Exits with a summary of passed / failed layers.

---

## Database helpers

All `db-*.sh` scripts resolve the SQLite path via `scripts/lib/_db.sh`'s
`recall_db_path`. The app stores each profile's settings + DB under
`<base>/profiles/<name>/`, so the script chains three lookups: the
install-wide base directory, the active profile name, then the DB file
inside that profile's directory.

| OS | Default base directory |
|---|---|
| macOS | `~/Library/Application Support/Recall/` |
| Linux | `~/.config/recall/` (or `$XDG_CONFIG_HOME/recall/`) |
| Windows | `%AppData%\Recall\` |

The active profile comes from `<base>/profiles.json`'s
`active_profile` field, falling back to `main` on a fresh install
where the app hasn't yet been launched. So the default DB path on
macOS — with the default `main` profile — resolves to
`~/Library/Application Support/Recall/profiles/main/db/recall.db`.

Overrides (most-specific wins):

- **`RECALL_DB=<full-path>`** — point at any `.db` file directly. Use
  this when inspecting a copy, a hermetic fixture, or a peer's
  exported DB.
- **`RECALL_PROFILE=<name>`** — operate on a specific profile (mirrors
  the app's `--profile=<name>` CLI flag). Doesn't switch the app's
  active profile; just scopes this script invocation.
- **`RECALL_DATA_DIR=<base>`** — override the install-wide base
  directory. mise.toml `[env]` sets this to `<repo>/data` so
  `wails dev` and the `db-*.sh` scripts share the in-repo dev data
  automatically when mise is active.

Post-PR-#45 the schema is 3NF: five **parent** tables
(`summary_screenshots`, `teams_screenshots`, `personal_screenshots`,
`rank_screenshots`, `unknown_screenshots`), five **child** tables with
`ON DELETE CASCADE`. A "match" is any distinct `match_key` seen across
the parents. The Go aggregator in `pkg/app/aggregate.go` is what folds
them into the shape `/api/v1/matches` returns; these scripts inspect
the raw rows the aggregator works from.

Lookups across `db-show.sh` / `db-delete.sh` / `db-reparse.sh` accept:

- `match:YYYY-MM-DDTHH:MM:SS` — exact match_key
- a filename substring (e.g. the trailing timestamp from a screenshot
  filename) — matches against `filename` on every parent
- a map-name substring — only `db-show.sh` (matches `SUMMARY.map`)

### `db-where.sh`

Print the resolved DB path; also prints whether the file exists + its
size on stderr. Use in shell sessions: `sqlite3 "$(scripts/db/db-where.sh)"`.

### `db-list.sh`

Print a one-line summary of every match with a five-letter coverage
chip (`S`/`T`/`P`/`R`/`U` for summary/teams/personal/rank/unknown,
`-` when absent).

```sh
bash scripts/db/db-list.sh
```

Output columns: `match_key`, `types`, `map`, `playlist`, `hero`,
`eliminations/assists/deaths`, `damage/healing/mitigation`, `result`,
`score`, `date`. SUMMARY fields take precedence over TEAMS for
display when both contribute.

### `db-show.sh`

Show every per-screenshot-type row contributing to one match, with
children nested under their parent. Use this when investigating an
aggregator surprise — it surfaces the raw truth across all five
parent tables instead of the folded view.

```sh
bash scripts/db/db-show.sh match:2026-05-10T21:29:28
bash scripts/db/db-show.sh 22.36.31.03   # filename substring
bash scripts/db/db-show.sh rialto        # map substring
```

Pipes through `jq` for formatting when available.

### `db-stats.sh`

Per-table row counts + a coverage histogram (matches grouped by how
many distinct screenshot types they have). Health snapshot for a dev
DB; tells you at a glance whether a parse run is producing
well-correlated matches or a pile of singletons.

### `db-orphans.sh`

List matches whose `match_key` appears in only one parent table —
i.e. incomplete captures that would benefit from re-taking the missing
screenshot types. The PR-#45 "fix later by adding screenshots" workflow
starts here: re-capture the missing tab in-game, drop the PNG in the
screenshots dir, click Parse — the correlation pass folds it into the
existing key.

### `db-delete.sh`

Delete one match's rows across all 5 parent tables (children CASCADE).
Prompts before deleting; pass `-y` to skip the prompt for scripted use.

```sh
bash scripts/db/db-delete.sh match:2026-05-10T21:29:28
bash scripts/db/db-delete.sh -y 22.36.31.03
```

### `db-reparse.sh`

Drop one match's rows so the next Parse re-OCRs its PNG files fresh.
Inner loop for parser iteration — tweak the parser, run this against a
match_key you're debugging, click Parse. The PNG files themselves are
untouched.

Wraps `db-delete.sh`; the separate name documents intent
(delete = throw away; reparse = iterate on the parser against the same
captures).

### `db-export.sh`

Dump every match as newline-delimited JSON to stdout — one line per
match, each line a JSON object with the per-type row arrays (`summary`,
`teams`, `personal`, `rank`, `unknown`).

```sh
bash scripts/db/db-export.sh
bash scripts/db/db-export.sh > export.ndjson
jq -s '.[].match_key' export.ndjson    # all keys
```

Captures the raw per-screenshot truth, not the aggregator's output —
use `jq` to fold if you need a flat shape.

### `clear-db.sh`

Delete **all** rows from every parent table (children CASCADE) and
VACUUM. No confirmation prompt — intended for development resets.
Equivalent to the **Clear Database** button in the Recall UI. Also
detects + wipes a pre-PR-#45 `match_results` table if one is still
present (lets you cut over a dev DB without manual schema repair).

---

## Dependency checker

### `check-deps.sh`

Compare pinned tool versions against the latest GitHub releases.
Called via `task check-deps`; safe to run directly.

```sh
bash scripts/ci/check-deps.sh
task check-deps
```

Checks:

| Tool       | Pin location                        | Source of latest       |
|------------|-------------------------------------|------------------------|
| Wails CLI  | `.devcontainer/postCreate.sh` + CI  | GitHub releases        |
| hadolint   | `.devcontainer/postCreate.sh`       | GitHub releases        |
| lefthook   | `.devcontainer/postCreate.sh`       | GitHub releases        |
| trivy      | `.devcontainer/postCreate.sh`       | GitHub releases        |
| Go         | `devcontainer.json` (informational) | go.dev/VERSION         |
| Node       | `devcontainer.json` (informational) | nodejs.org             |

Exits 0 when all binary tool pins are current, 1 when any are behind.
Go and Node rows are informational — the devcontainer feature and
`setup-go` / `setup-node` actions install the latest patch within the
pinned major.minor automatically.

Requires `curl` and `jq`.

---

## Internal libraries

### `_lib.sh`

Shared helper library. Not executable on its own — sourced by
`stack-up.sh` and `prometheus-clear.sh`.

Provides `docker_config_aside()`, which temporarily moves
`~/.docker/config.json` out of the way when it references
`docker-credential-gcloud` but that binary is no longer on PATH (a
common leftover after removing gcloud). Without this workaround,
`podman-compose` fails to pull images because it falls through to the
Docker credential helper chain. The original config is restored on
script exit via a `trap`.

### `_db.sh`

Shared helper library for the `db-*.sh` scripts. Not executable on its
own. Provides:

- `recall_base_dir` — echo the install-wide base directory (parent of
  `profiles/`), honoring `RECALL_DATA_DIR`. Mirrors
  `pkg/app/settings.go::appBaseDir`.
- `recall_active_profile` — echo the profile name the scripts should
  operate on. Resolves `RECALL_PROFILE`, then `profiles.json`'s
  `active_profile`, then `main`.
- `recall_db_path` — echo the SQLite path for the currently-active
  profile (`<base>/profiles/<active>/db/recall.db`), or the `RECALL_DB`
  override if set.
- `parent_tables` / `child_tables` — newline-separated table-name lists
  for loops.
- `require_new_schema "$db"` — exit 1 with a clear message if the DB
  is missing or still carries the pre-PR-#45 `match_results` table.
