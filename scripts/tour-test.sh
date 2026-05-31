#!/usr/bin/env bash
# Boot a fresh, isolated Recall server for testing the first-launch
# onboarding tour. Lets you walk the tour repeatedly without
# touching your real data or shipping the "tour completed" flag
# back to your normal browser profile.
#
# How the tour decides whether to auto-open:
#
#   useOnboardingTour reads the BROWSER localStorage key
#   `recall.onboardingCompleted` on mount. If it's missing or the
#   value isn't the literal string "true", the tour opens. Skip /
#   Finish / Escape all write "true" to that key, so the tour
#   stays dismissed across reloads for the lifetime of that
#   browser-profile + origin pair.
#
#   The flag lives in the browser, not on the server. Wiping the
#   server's data dir does NOT reset the tour — the tour decision
#   never round-trips to the API.
#
# What this script does:
#
#   - Builds the frontend + a `serveronly` Recall binary into the
#     repo's tmp/ scratch dir.
#   - Boots the binary against an isolated `RECALL_DATA_DIR` so the
#     fresh server has no records — every tour stop lands on demo
#     data and the dossier KPIs read the curated DEMO_MATCHES.
#   - Listens on 127.0.0.1:7100 by default. Override with
#     `--port=N`. The port is intentionally NOT the dev default
#     (7000) so you can run this alongside `make dev` if you want.
#   - Prints the three ways to actually see the tour fresh in your
#     browser (incognito window is the cleanest path).
#
# Tear down with Ctrl+C — the trap kills the server and removes
# the isolated data dir. `--keep` retains the data dir if you want
# to inspect the SQLite file the fresh server created.
#
# Usage:
#
#   scripts/tour-test.sh
#   scripts/tour-test.sh --port=7102
#   scripts/tour-test.sh --keep
#
# `set -u` so an unset env reference fails loudly. Not `-e`; the
# trap-based cleanup needs the script to keep running through a
# failed sub-step so the temp dir + server still get torn down.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT=7100
KEEP_DATA=0

for arg in "$@"; do
  case "$arg" in
    --port=*)
      PORT="${arg#--port=}"
      ;;
    --keep)
      KEEP_DATA=1
      ;;
    -h | --help)
      sed -n '1,/^set -u$/ p' "$0"
      exit 0
      ;;
    *)
      echo "[tour-test] unknown arg: $arg" >&2
      echo "[tour-test] usage: $0 [--port=N] [--keep]" >&2
      exit 2
      ;;
  esac
done

ISOLATED_DIR="$REPO_ROOT/tmp/tour-test"
BINARY="$REPO_ROOT/tmp/recall-tour-server"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    echo
    echo "[tour-test] stopping server (pid $SERVER_PID)…"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ "$KEEP_DATA" = "0" ]; then
    rm -rf "$ISOLATED_DIR"
    echo "[tour-test] cleaned isolated data dir: $ISOLATED_DIR"
  else
    echo "[tour-test] retained isolated data dir: $ISOLATED_DIR"
  fi
}
trap cleanup INT TERM EXIT

cd "$REPO_ROOT" || {
  echo "[tour-test] could not cd into repo root" >&2
  exit 1
}

mkdir -p "$ISOLATED_DIR"
mkdir -p "$(dirname "$BINARY")"

echo "[tour-test] building frontend bundle…"
if ! (cd frontend && npm run build > /dev/null 2>&1); then
  echo "[tour-test] frontend build FAILED — running again with output for triage:" >&2
  (cd frontend && npm run build) || exit 1
fi

echo "[tour-test] building serveronly binary…"
if ! go build -tags serveronly -o "$BINARY" .; then
  echo "[tour-test] go build FAILED" >&2
  exit 1
fi

URL="http://127.0.0.1:$PORT/"

echo
echo "──────────────────────────────────────────────────────────────────"
echo "[tour-test] starting Recall against an isolated data dir"
echo "  Data dir:  $ISOLATED_DIR"
echo "  Listening: $URL"
echo "──────────────────────────────────────────────────────────────────"
echo

# Run with HOME pointed at the isolated dir AS WELL so any platform-
# default-path lookups (settings.json on macOS Library / Linux XDG)
# resolve under the temp tree instead of the user's real config dir.
HOME="$ISOLATED_DIR" RECALL_DATA_DIR="$ISOLATED_DIR" RECALL_SERVER_ADDR="127.0.0.1:$PORT" \
  "$BINARY" &
SERVER_PID=$!

# Give the server a beat to bind the port before we print the
# walkthrough. If the bind fails the server exits and the trap fires.
sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "[tour-test] server died on startup — aborting." >&2
  exit 1
fi

cat <<EOF

✓ Server is up. Three ways to actually see a FRESH tour:

  1. Open an INCOGNITO / PRIVATE window and visit:
        $URL
     This is the cleanest path — incognito has empty localStorage
     so the tour gate fires on first paint, no reset needed.

  2. Open $URL in your normal browser. If you've already
     dismissed the tour at some point, open DevTools (F12), then:
        > localStorage.removeItem('recall.onboardingCompleted')
        > location.reload()
     The next paint walks the tour fresh.

  3. Manually replay (no DevTools): once the tour shipped a
     "Replay onboarding tour" affordance under Settings →
     Advanced you'll be able to click that. Until then incognito
     or DevTools are the way.

The tour reads recall.onboardingCompleted; if it's missing or not
literally "true", it auto-opens. Skip / Done / Esc all write
"true", so any dismissal sticks. The flag lives in YOUR browser,
not on the server.

Press Ctrl+C to stop the server and clean the isolated data dir.

EOF

# Block on the server. The trap handles SIGINT / SIGTERM.
wait "$SERVER_PID"
