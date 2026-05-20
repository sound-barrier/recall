# scripts/

Helper scripts for running, inspecting, and maintaining Recall locally.
All scripts are safe to re-run from any working directory — they resolve
paths relative to their own location.

| Script | Purpose |
|---|---|
| [`stack-up.sh`](#stack-upsh) | Start the Prometheus + Grafana stack (starts Podman VM, syncs clock, runs compose up). |
| [`stack-down.sh`](#stack-downsh) | Stop the stack; pass `--machine` to also stop the Podman VM. |
| [`prometheus-clear.sh`](#prometheus-clearsh) | Wipe Prometheus's TSDB volume and restart clean; Grafana state is untouched. |
| [`verify-stack.sh`](#verify-stacksh) | Read-only layer-by-layer diagnostic: SQLite → /metrics → containers → scrape state → TSDB. |
| [`db-list.sh`](#db-listsh) | Print a one-line summary of every row in `match_results`. |
| [`db-show.sh`](#db-showsh) | Pretty-print one record's full JSON by id, match key, or source-file substring. |
| [`db-delete.sh`](#db-deletesh) | Delete one record with a confirmation prompt. |
| [`db-export.sh`](#db-exportsh) | Dump every record as newline-delimited JSON to stdout. |
| [`clear-db.sh`](#clear-dbsh) | Delete all rows from `match_results` and vacuum; equivalent to the UI's Clear Database button. |
| [`check-deps.sh`](#check-depssh) | Compare pinned tool versions (Wails, hadolint, lefthook, trivy) against latest GitHub releases. |
| [`_lib.sh`](#_libsh) | Internal library sourced by `stack-up.sh` and `prometheus-clear.sh`; not run directly. |

---

## Observability stack

These scripts manage the Prometheus + Grafana stack defined in
`docker-compose.yml`. They use `podman-compose` by default; set
`DOCKER=docker` in `.envrc` to swap the runtime.

### `stack-up.sh`

Start the Prometheus + Grafana stack.

```sh
bash scripts/stack-up.sh
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
bash scripts/stack-down.sh             # stop containers, leave VM running
bash scripts/stack-down.sh --machine   # also stop the Podman VM
```

### `prometheus-clear.sh`

Wipe Prometheus's TSDB volume and restart with a clean slate. Grafana
state (dashboards, datasource config) is untouched.

```sh
bash scripts/prometheus-clear.sh
```

Prompts for confirmation before deleting. Use this when you have
accumulated noisy or wrongly-timestamped samples during testing.

### `verify-stack.sh`

Read-only layer-by-layer diagnostic. Run this first whenever Grafana
shows no data.

```sh
bash scripts/verify-stack.sh
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

All scripts resolve the DB path as `data/db/recall.db` relative to the
repo root. They accept an **id**, **match\_key**, or **source-file
substring** as a lookup key (where applicable).

### `db-list.sh`

Print a one-line summary of every row in `match_results`.

```sh
bash scripts/db-list.sh
```

Output columns: `id`, `match_key`, `map`, `mode`, `hero`,
`eliminations/assists/deaths`, `damage/healing/mitigation`, `result`,
`score`, `date`.

### `db-show.sh`

Pretty-print one record's full JSON.

```sh
bash scripts/db-show.sh <id|match-key|source-file-substring>

# examples
bash scripts/db-show.sh 42
bash scripts/db-show.sh match:2026-05-10T21:29:28
bash scripts/db-show.sh Rialto
```

Pipes through `jq` for formatting if it is available.

### `db-delete.sh`

Delete one record with a confirmation prompt.

```sh
bash scripts/db-delete.sh <id|match-key|source-file-substring>
```

Shows the matching row(s) and asks `[y/N]` before deleting. Useful for
removing a misparse without wiping the whole DB.

### `db-export.sh`

Dump every record as newline-delimited JSON to stdout.

```sh
bash scripts/db-export.sh
bash scripts/db-export.sh > export.ndjson
```

Each line is a complete match object with all scalar columns and JSON
blobs (`heroes_played`, `performance`, `modifiers`, `sr`) inlined as
proper JSON values (not escaped strings).

### `clear-db.sh`

Delete **all** rows from `match_results` and vacuum the DB.

```sh
bash scripts/clear-db.sh
```

No confirmation prompt — intended for development resets. Prints the
number of rows deleted. Equivalent to the **Clear Database** button in
the Recall UI.

---

## Dependency checker

### `check-deps.sh`

Compare pinned tool versions against the latest GitHub releases.
Called via `make check-deps`; safe to run directly.

```sh
bash scripts/check-deps.sh
make check-deps
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

## Internal library

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
