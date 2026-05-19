#!/usr/bin/env bash
# Walk the Recall → Prometheus pipeline layer by layer and report which
# stage is healthy. Run this first whenever Grafana shows no data.
#
# Layers:
#   1. SQLite                              (source of truth)
#   2. Wails app /metrics endpoint        (collector reads SQLite)
#   3. Podman VM + prometheus container   (scraper runtime)
#   4. Prometheus scrape state            (Prometheus → app reachable)
#   5. Prometheus TSDB samples            (ingested data exists)
#
# This script is read-only — it never starts or stops anything. If a layer
# is down, fix it via the relevant script (stack-up.sh / wails dev / etc.)
# and re-run.
#
# `set -u` not `-e` so every layer reports its state even if earlier ones
# failed.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || {
  echo "[verify-stack] could not cd into repo root from $SCRIPT_DIR" >&2
  exit 1
}

DB="data/db/recall.db"

# Default to :9091; honor the same env var app.go / metrics.ListenAndServe do.
METRICS_ADDR="${OWMETRICS_METRICS_ADDR:-:9091}"
METRICS_HOST="${METRICS_ADDR%:*}"
METRICS_HOST="${METRICS_HOST:-127.0.0.1}"
METRICS_PORT="${METRICS_ADDR##*:}"
METRICS_URL="http://${METRICS_HOST}:${METRICS_PORT}/metrics"

PROM_URL="http://127.0.0.1:9090"

PASS=0
FAIL=0
pass() {
  echo "  ✓ $*"
  PASS=$((PASS + 1))
}
fail() {
  echo "  ✗ $*"
  FAIL=$((FAIL + 1))
}
note() { echo "    $*"; }

# ── Layer 1: SQLite ────────────────────────────────────────────────────────
echo "[1] SQLite (source of truth)"
if [[ -f "$DB" ]]; then
  pass "db file present at $DB"
  rows=$(sqlite3 "$DB" "SELECT COUNT(*) FROM match_results" 2>/dev/null || echo "?")
  if [[ "$rows" =~ ^[0-9]+$ ]] && ((rows > 0)); then
    pass "$rows row(s) in match_results"
    range=$(sqlite3 "$DB" \
      "SELECT MIN(date || ' ' || finished_at) || ' → ' || MAX(date || ' ' || finished_at)
       FROM match_results WHERE date != '' AND finished_at != ''" 2>/dev/null)
    [[ -n "$range" && "$range" != " → " ]] && note "match timestamps: $range"
  else
    fail "match_results is empty (run the Wails app and click Parse Screenshots)"
  fi
else
  fail "no db at $DB — start the Wails app at least once"
fi

# ── Layer 2: Wails app /metrics endpoint ───────────────────────────────────
echo
echo "[2] Wails /metrics endpoint ($METRICS_URL)"
if metrics_body=$(curl -fsS --max-time 3 "$METRICS_URL" 2>/dev/null); then
  pass "endpoint reachable"
  ow_lines=$(printf '%s\n' "$metrics_body" | grep -c '^recall_' || true)
  if ((ow_lines > 0)); then
    pass "$ow_lines recall_* sample line(s) in the response"
  else
    fail "endpoint up but no recall_* samples — collector isn't producing data"
    note "is the DB empty? see layer 1 above"
  fi
else
  fail "endpoint not reachable — is 'wails dev' (or the built app) running?"
fi

# ── Layer 3: Podman + Prometheus container ─────────────────────────────────
echo
echo "[3] Podman VM + prometheus container"
if podman info >/dev/null 2>&1; then
  pass "podman daemon reachable"
else
  fail "podman daemon not reachable — run ./scripts/stack-up.sh"
fi

if state=$(podman inspect -f '{{.State.Status}} {{.RestartCount}}' recall-prometheus 2>/dev/null); then
  status="${state% *}"
  restarts="${state#* }"
  if [[ "$status" == "running" ]] && ((restarts < 3)); then
    pass "recall-prometheus container running (restart count: $restarts)"
  elif [[ "$status" == "running" ]]; then
    fail "container is running but has restarted $restarts times — likely crash-looping"
    note "see: podman logs --tail 20 recall-prometheus"
  else
    fail "container state: $status"
  fi
else
  fail "recall-prometheus container not found — run ./scripts/stack-up.sh"
fi

# ── Layer 4: Prometheus scrape state ───────────────────────────────────────
echo
echo "[4] Prometheus scrape of recall target"
if up_resp=$(curl -fsS --max-time 3 "$PROM_URL/api/v1/query?query=up%7Bjob%3D%22recall%22%7D" 2>/dev/null); then
  pass "Prometheus API reachable"
  state=$(printf '%s' "$up_resp" | jq -r '.data.result[0].value[1] // empty' 2>/dev/null)
  case "$state" in
    1) pass "recall target is UP (Prometheus can reach Wails app)" ;;
    0)
      fail "recall target is DOWN — Prometheus can't reach $METRICS_URL"
      note "from inside the VM, host.docker.internal:$METRICS_PORT must be reachable"
      note "see: curl $PROM_URL/api/v1/targets"
      ;;
    *) fail "no 'up' sample for recall yet — Prometheus may not have scraped (wait ~30s)" ;;
  esac
else
  fail "Prometheus API not reachable at $PROM_URL — is the container up? (see layer 3)"
fi

# ── Layer 5: Prometheus TSDB sample count ──────────────────────────────────
# Recall samples are timestamped at the match's `finished_at` time, which
# can be hours or days in the past. An instant query at "now" wouldn't see
# them (Prometheus's default 5-min lookback excludes historical samples),
# so we query *at* the max sample time using the `@` modifier.
echo
echo "[5] Prometheus TSDB samples"
# Count distinct match series in the TSDB over a wide range. count_over_time
# on a single metric returns one result per (match_key, ...) series with the
# number of samples; wrapping it in count() gives us the number of unique
# series — i.e. how many distinct matches Prometheus has ingested.
query='count(count_over_time(recall_match_eliminations%5B365d%5D))'
if count_resp=$(curl -fsS --max-time 3 "$PROM_URL/api/v1/query?query=$query" 2>/dev/null); then
  count=$(printf '%s' "$count_resp" | jq -r '.data.result[0].value[1] // "0"' 2>/dev/null)
  if [[ "$count" =~ ^[0-9]+$ ]] && ((count > 0)); then
    pass "$count distinct match series in TSDB (over the last 365d)"
    if [[ "${rows:-}" =~ ^[0-9]+$ ]] && ((count == rows)); then
      pass "TSDB series count matches SQLite row count"
    elif [[ "${rows:-}" =~ ^[0-9]+$ ]]; then
      fail "TSDB has $count, SQLite has $rows — some matches missing from Prometheus"
      note "may be out-of-order rejection or out-of-bounds (samples older than head's min)"
      note "see: $PROM_URL/graph?g0.expr=count_over_time(recall_match_eliminations%5B365d%5D)"
    fi
  else
    fail "no samples ingested — Prometheus is rejecting them"
    # Diagnose the most likely cause: out-of-order / out-of-bounds rejection.
    ooo_resp=$(curl -fsS --max-time 3 "$PROM_URL/api/v1/query?query=sum(prometheus_target_scrapes_sample_out_of_order_total)" 2>/dev/null || true)
    ooo=$(printf '%s' "$ooo_resp" | jq -r '.data.result[0].value[1] // "0"' 2>/dev/null)
    if [[ "$ooo" =~ ^[0-9]+$ ]] && ((ooo > 0)); then
      note "Prometheus has rejected $ooo out-of-order samples — check storage.tsdb.out_of_order_time_window in prometheus.yml"
      note "live config: curl '$PROM_URL/api/v1/status/config' | jq -r '.data.yaml' | grep -A2 storage"
    fi
    note "or query manually: $PROM_URL/graph?g0.expr=recall_match_eliminations"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo
echo "Summary: $PASS passed, $FAIL failed"
exit $((FAIL > 0 ? 1 : 0))
