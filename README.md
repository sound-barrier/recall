# README

## About

This is the official Wails Vue template.

You can configure the project by editing `wails.json`. More information about the project settings can be found
here: https://wails.io/docs/reference/project-config

## Live Development

To run in live development mode, run `wails dev` in the project directory. This will run a Vite development
server that will provide very fast hot reload of your frontend changes. If you want to develop in a browser
and have access to your Go methods, there is also a dev server that runs on http://localhost:34115. Connect
to this in your browser, and you can call your Go code from devtools.

## Building

To build a redistributable, production mode package, use `wails build`.

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
| `recall_match_eliminations` (and `_assists`, `_deaths`, `_damage`, `_healing`, `_mitigation`) | `match_key, map, type, mode, result` | Core scoreboard stats. |
| `recall_match_result` | …, `result` | Constant `1`; `count()` in Grafana gives match counts grouped by outcome. |
| `recall_match_rank_level` | … | Competitive rank sub-division (1–5). |
| `recall_match_sr` / `recall_match_sr_change` | …, `hero`, `role` | Per-hero SR + delta from each match. |
| `recall_hero_stat` | …, `hero`, `role`, `stat` | Open-ended per-hero stats (`weapon_accuracy`, `players_saved`, …). |
