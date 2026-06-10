# Charts & Dashboards (Prometheus + Grafana)

Recall already shows all your match history in the **Matches** tab — you don't
need any of this for everyday use. This page is for players who want
**time-series charts**: win-rate trends over weeks, SR over time, damage vs.
healing scatter plots, and "which maps am I worst on?" tables.

The short version: Recall feeds a local [Grafana](https://grafana.com/)
dashboard by publishing its match data as
[Prometheus](https://prometheus.io/) metrics. Both run as containers on your
machine alongside Recall.

---

## What you'll get

The bundled Grafana dashboard includes:

- **Eliminations per match** over time
- **SR over time** per hero
- **Win rate** grouped by hero, map, or mode
- **Damage vs. healing** scatter
- **"Worst maps"** table sorted by win rate

Each data point is stamped with the actual time the match ended — not when
Recall scanned the screenshot — so the timeline stays accurate even if you
parse screenshots weeks later.

---

## Option A: Bundled stack (recommended)

The repo ships a ready-made `docker-compose.yml` that starts Prometheus and
Grafana pre-configured to talk to Recall. This is the easiest path.

**One-time setup (macOS):**

```sh
brew install podman podman-compose
```

Docker Desktop or Colima also work — the compose file is standard v3.

**Start the stack:**

```sh
./scripts/stack-up.sh
```

This starts the Podman VM if needed, syncs the clock (prevents timestamp
drift), and runs `podman-compose up -d`.

| What | Where |
|---|---|
| Grafana dashboard | <http://localhost:3000> (login: `admin` / `admin`) |
| Prometheus | <http://localhost:9090> |

**Stop the stack:**

```sh
./scripts/stack-down.sh             # stop containers, keep data
./scripts/stack-down.sh --machine   # also stop the Podman VM
```

**Wipe Prometheus data** (keeps Grafana settings):

```sh
./scripts/prometheus-clear.sh
```

---

## Option B: Bring your own containers

If you already run Docker or Podman and don't want to use the helper scripts,
start the containers manually using the config files in this repo.

```sh
# Prometheus
docker run -d \
  --name recall-prometheus \
  -p 9090:9090 \
  -v "$(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
  prom/prometheus:v2.53.0

# Grafana
docker run -d \
  --name recall-grafana \
  -p 3000:3000 \
  --link recall-prometheus:prometheus \
  -v "$(pwd)/grafana/provisioning:/etc/grafana/provisioning:ro" \
  grafana/grafana:11.1.0
```

On Linux, add `--add-host host.docker.internal:host-gateway` to the Prometheus
command so the container can reach the metrics endpoint on your host.

---

## Option C: Native install (no containers)

If you'd rather not use Docker at all, install Prometheus and Grafana as local
services. You'll need to adjust two config values first:

1. In `prometheus.yml`: change `host.docker.internal:9091` → `localhost:9091`
2. In `grafana/provisioning/datasources/prometheus.yml`: change
   `http://prometheus:9090` → `http://localhost:9090`

**macOS:**

```sh
brew install prometheus grafana
cp prometheus.yml /opt/homebrew/etc/prometheus.yml
mkdir -p /opt/homebrew/etc/grafana/provisioning
cp -r grafana/provisioning/. /opt/homebrew/etc/grafana/provisioning/
brew services start prometheus
brew services start grafana
```

**Linux:**

```sh
# Prometheus — download from https://prometheus.io/download/
sudo cp prometheus.yml /etc/prometheus/prometheus.yml
sudo systemctl restart prometheus

# Grafana — https://grafana.com/docs/grafana/latest/setup-grafana/installation/debian/
sudo apt install -y grafana
sudo cp -r grafana/provisioning/. /etc/grafana/provisioning/
sudo systemctl restart grafana-server
```

**Windows:**

```powershell
winget install Grafana.Grafana
# Prometheus: download from https://prometheus.io/download/; extract anywhere
# Copy prometheus.yml to the Prometheus working directory
# Copy grafana/provisioning/ to Grafana's conf/provisioning/ directory
# Start both services
```

> **Grafana datasource UID:** every panel in `grafana/provisioning/dashboards/recall.json`
> hardcodes `"datasource": {"uid": "prometheus"}`. The provisioning file sets
> this automatically. If you add the datasource manually via the Grafana UI,
> set the **UID** field to exactly `prometheus` — otherwise all panels show
> "datasource not found".

---

## Turning on the metrics endpoint in Recall

Open Recall and go to **Settings → Advanced → Stream to Grafana** and switch it on.
This starts the metrics endpoint at `http://localhost:9091/metrics`. Nothing
is exposed until you enable it.

> **Network exposure.** The endpoint binds `:9091` on **all interfaces** by
> default — this is required so the bundled Prometheus container can reach the
> host. `/metrics` has no authentication (standard for Prometheus) and serves
> your match data, so on a shared network any host that can reach port 9091 can
> read it. If you scrape from the same machine instead of the bundled Docker
> stack, set `RECALL_METRICS_ADDR=127.0.0.1:9091` to bind localhost-only. Recall
> logs a notice at startup whenever it binds to a non-loopback address.

---

## Troubleshooting

**Grafana shows no data**

Run the layer-by-layer verifier first — it tells you exactly where the chain breaks:

```sh
./scripts/verify-stack.sh
```

It checks: SQLite → `/metrics` endpoint → containers running → Prometheus
scrape state → TSDB sample count. The first ✗ is your problem.

**`Cannot connect to the Docker daemon` / `podman ps` exits 125**

The container runtime VM isn't running.

```sh
podman machine start   # Podman
colima start           # Docker via Colima
```

**`docker-credential-gcloud … executable file not found`**

A leftover `gcloud` credential helper in `~/.docker/config.json` is blocking
image pulls. Strip it:

```sh
cp ~/.docker/config.json ~/.docker/config.json.bak
jq 'del(.credsStore, .credHelpers)' ~/.docker/config.json > /tmp/dc \
  && mv /tmp/dc ~/.docker/config.json
podman-compose down && podman-compose up -d
```

---

## Metric reference

| Metric | Labels | What it measures |
|---|---|---|
| `recall_match_eliminations` (+ `_assists`, `_deaths`, `_damage`, `_healing`, `_mitigation`) | `match_key, map, type, mode, result, hero, role` | Core scoreboard stats per match |
| `recall_match_result` | …, `result` | Always `1`; use `count()` in Grafana to count matches by outcome |
| `recall_match_rank_level` | … | Competitive rank subdivision (1–5) |
| `recall_match_sr` / `recall_match_sr_change` | …, `hero`, `role` | Per-hero SR and delta per match |
| `recall_hero_stat` | …, `hero`, `role`, `stat` | Per-hero extended stats (`weapon_accuracy`, `players_saved`, …) |
