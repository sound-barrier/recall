# Recall

**Recall** is a desktop app for Overwatch 2 players who want to understand
their performance trends over time. It watches a folder of OW2 post-match
screenshots, OCRs them with Tesseract, merges per-match data into a local
SQLite database, and optionally exposes the match history as Prometheus
metrics so a bundled Grafana dashboard can chart win rates, SR trends, and
per-hero stats.

Stack: Go + Wails v2 desktop shell · Vue 3 + Vite frontend ·
`modernc.org/sqlite` (pure-Go) · Tesseract CLI · Prometheus + Grafana.

## Prerequisites

- **Tesseract OCR** — required for screenshot parsing. Install via Homebrew (`brew install tesseract`) on macOS, `apt install tesseract-ocr` on Linux, or the [Windows installer](https://github.com/UB-Mannheim/tesseract/wiki). On first launch Recall auto-detects the standard install path; use **Settings → Engine** to point it elsewhere if needed.

Settings and the match database are stored in the platform user-config directory:
- macOS: `~/Library/Application Support/Recall/`
- Linux: `~/.config/recall/`
- Windows: `%AppData%\Recall\`

## Development

```sh
make dev        # hot-reload (macOS only — Wails uses the native WebKit shell)
```

This starts a Vite dev server on `:5173` with HMR and a Wails IPC dev
endpoint on `:34115`. Go is rebuilt automatically on save.

## Building

Recall ships two binary flavours:

| Flavour | What it is | CGo? |
|---|---|---|
| **Wails app** | Native desktop window (WebKit/WebView2) | Yes — needs platform WebView libs |
| **Server** | Headless HTTP server (default `127.0.0.1:7000`, override with `RECALL_SERVER_ADDR`) | No — pure Go, cross-compilable anywhere |

### Wails desktop app

```sh
make build-linux        # Linux/amd64   → dist/linux/Recall
make build-windows      # Windows/amd64 → dist/windows/Recall.exe
make build-mac          # macOS universal .app → dist/mac/Recall.app  (macOS host required)
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
make build-server-mac        # macOS arm64+amd64 → dist/server-mac/  (Docker, no Apple SDK!)
make build-server-all        # all three server builds
make build-server-container  # Linux container image with Tesseract → recall-server:local
```

### Running the server

```sh
./Recall-server                 # dedicated server binary — always starts HTTP mode
./Recall --server               # Wails binary with runtime flag — same HTTP mode
./Recall -s                     # short form
```

The server listens on `http://127.0.0.1:7000` by default (localhost-only). Set
`RECALL_SERVER_ADDR` to override (e.g. `RECALL_SERVER_ADDR=0.0.0.0:7000` to accept
connections from other hosts). Open the address in any browser to get the full Recall
match dashboard. REST API available at `/api/*`.

### Running via Docker

The `build-server-container` target produces a `debian:bookworm-slim` image with
Tesseract pre-installed. The default bind address is localhost-only, so pass
`RECALL_SERVER_ADDR` to make the port reachable from outside the container:

```sh
docker run \
  -e RECALL_SERVER_ADDR=0.0.0.0:7000 \
  -p 7000:7000 \
  ghcr.io/sound-barrier/recall-server:latest
```

The pre-built image is pushed to GHCR on every tagged release.

### Other build commands

```sh
make clean              # remove dist/
DOCKER=podman make ...  # use Podman instead of Docker
go build ./...          # compile-check Wails variant
go build -tags serveronly ./...  # compile-check server variant
```

> **One-time setup after clone:** delete `frontend/wailsjs/go/main/` (stale — the package
> moved from `main` to `app`) and run `wails dev` once to regenerate the bindings at
> `frontend/wailsjs/go/app/App.js`. Also re-run after adding new exported methods to `App`.

## Metrics & Grafana

The app exposes its parsed match history as Prometheus metrics on
`http://localhost:9091/metrics` whenever it's running. Each sample carries
the match's actual end time (`date + finished_at`) as its timestamp, so
Grafana plots match stats at the moment they happened — not at scrape time.

To bring up the bundled Prometheus + Grafana stack:

```sh
brew install podman podman-compose  # one-time
./scripts/stack-up.sh               # starts the podman VM if needed, then compose up
```

To tear it down:

```sh
./scripts/stack-down.sh             # stop containers (volumes preserved)
./scripts/stack-down.sh --machine   # also stop the podman VM
```

To wipe Prometheus history without touching anything else:

```sh
./scripts/prometheus-clear.sh       # confirms, then removes the TSDB volume
```

- Prometheus: <http://localhost:9090>
- Grafana: <http://localhost:3000>  (login `admin` / `admin`)

The compose file is plain compose v3 — it also works with `docker compose`
if you'd rather run Docker Desktop / Colima. Podman is the default we test
against.

### Troubleshooting

**Grafana shows no data / unsure if metrics are flowing**
Run the verifier — it walks SQLite → /metrics → Prometheus container →
scrape state → TSDB and prints a ✓/✗ for each layer:

```sh
./scripts/verify-stack.sh
```

The first ✗ line tells you which stage is broken; the rest of the script
keeps going so you see the state of everything else too.

**`Cannot connect to the Docker daemon …` / `podman ps` exits 125**
The Linux VM that hosts the daemon isn't running. For Podman, run
`podman machine start` (one-time `podman machine init` if it's never been
created). For Docker on Homebrew, you'll need a separate runtime —
`colima start` is the easiest.

**`error getting credentials … docker-credential-gcloud … executable file not found`**
Your `~/.docker/config.json` has a `credsStore` or `credHelpers` entry
(usually left behind by `gcloud auth configure-docker`). Podman's image-pull
path falls back to `~/.docker/config.json` for credential helpers even when
its own `auth.json` exists, so just creating an empty Podman auth file
does NOT fix this — you have to strip the entries from the Docker config
itself:

```sh
cp ~/.docker/config.json ~/.docker/config.json.bak
jq 'del(.credsStore, .credHelpers)' ~/.docker/config.json > /tmp/dc \
  && mv /tmp/dc ~/.docker/config.json
podman-compose down                 # clear any half-started state
podman-compose up -d
```

This removes both the global `credsStore` line and the per-registry
`credHelpers` map; any `auths` or other settings in the file are
preserved. To restore the gcloud helpers later, either
`cp ~/.docker/config.json.bak ~/.docker/config.json` or re-run
`gcloud auth configure-docker`.

The "Recall" dashboard is auto-provisioned: eliminations per match, SR
over time, win rate by hero, and damage-vs-healing scatter.

Override the metrics endpoint address with `OWMETRICS_METRICS_ADDR` (e.g.
`OWMETRICS_METRICS_ADDR=:9292 wails dev`). Prometheus accepts historical
timestamps because the stack runs with `--storage.tsdb.out-of-order-time-window=8760h`.

### Metric overview

| Metric | Labels | Notes |
|---|---|---|
| `recall_match_eliminations` (and `_assists`, `_deaths`, `_damage`, `_healing`, `_mitigation`) | `match_key, map, type, mode, result, hero, role` | Core scoreboard stats. |
| `recall_match_result` | …, `result` | Constant `1`; `count()` in Grafana gives match counts grouped by outcome. |
| `recall_match_rank_level` | … | Competitive rank sub-division (1–5). |
| `recall_match_sr` / `recall_match_sr_change` | …, `hero`, `role` | Per-hero SR + delta from each match. |
| `recall_hero_stat` | …, `hero`, `role`, `stat` | Open-ended per-hero stats (`weapon_accuracy`, `players_saved`, …). |
