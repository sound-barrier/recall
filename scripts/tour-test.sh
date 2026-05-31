#!/usr/bin/env bash
# Boot Recall against an isolated data dir so you can repeatedly
# walk the first-launch onboarding tour without touching your real
# settings, real matches, or your normal browser's tour-completed
# flag.
#
# How the tour decides "new user":
#
#   useOnboardingTour reads the BROWSER localStorage key
#   `recall.onboardingCompleted` on mount. If it's missing or the
#   value isn't the literal string "true", the tour opens. Skip /
#   Finish / Escape all write "true" to that key, so the tour
#   stays dismissed across reloads for the lifetime of that
#   browser-profile + origin (or WebView profile) pair.
#
#   The flag lives in the browser / WebView, never the server.
#   Wiping the server's data dir does NOT reset the tour — the
#   tour decision never round-trips to the API.
#
# Two modes:
#
#   --mode=wails  (default — your primary dev path)
#       Runs `wails dev` against an isolated RECALL_DATA_DIR. Hot-
#       reload is on; the Wails WebView opens on its own. To reset
#       the tour gate: right-click in the app window → Inspect →
#       Console → `localStorage.removeItem(
#       'recall.onboardingCompleted')` → Cmd/Ctrl+R to reload.
#       (Incognito-style isolation isn't available in a single
#       WebView session, so DevTools is the reset path here.)
#
#   --mode=server
#       Builds frontend + a `serveronly` binary and listens on
#       127.0.0.1:$PORT. Use this when you want incognito-window
#       isolation — incognito has empty localStorage so the tour
#       fires on first paint without DevTools surgery.
#
# Tear down with Ctrl+C — the trap kills the server and removes
# the isolated data dir. `--keep` retains the data dir if you want
# to inspect what landed under it.
#
# Usage:
#
#   scripts/tour-test.sh                    # wails dev, default
#   scripts/tour-test.sh --mode=server      # serveronly + browser
#   scripts/tour-test.sh --mode=server --port=7102
#   scripts/tour-test.sh --keep
#
# `set -u` so unset env references fail loudly. Not `-e`; the
# trap-based cleanup needs the script to keep running through a
# failed sub-step so the temp dir + processes still get torn down.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="wails"
PORT=7100
KEEP_DATA=0

for arg in "$@"; do
  case "$arg" in
    --mode=*)
      MODE="${arg#--mode=}"
      case "$MODE" in
        wails | server) ;;
        *)
          echo "[tour-test] --mode must be 'wails' or 'server'; got '$MODE'" >&2
          exit 2
          ;;
      esac
      ;;
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
      echo "[tour-test] usage: $0 [--mode={wails,server}] [--port=N] [--keep]" >&2
      exit 2
      ;;
  esac
done

ISOLATED_DIR="$REPO_ROOT/tmp/tour-test"
SERVER_BINARY="$REPO_ROOT/tmp/recall-tour-server"
CHILD_PID=""

cleanup() {
  if [ -n "$CHILD_PID" ]; then
    echo
    echo "[tour-test] stopping (pid $CHILD_PID)…"
    # wails dev forks a chain of children (vite + go build + the
    # WebView host). Kill the whole process group so they all go
    # together; `kill -- -PGID` would be cleaner but isn't portable
    # under bash on macOS without enabling job control upfront.
    pkill -P "$CHILD_PID" 2>/dev/null || true
    kill "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
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

# ─── wails dev mode (default) ─────────────────────────────────────
if [ "$MODE" = "wails" ]; then
  if ! command -v wails > /dev/null 2>&1; then
    cat <<'EOF' >&2
[tour-test] `wails` CLI not on PATH.
  Install with:
      go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
  Then re-run, or use --mode=server for a browser-based smoke test.
EOF
    exit 1
  fi

  # Linux needs the webkit2_4_1 build tag — same dance `make dev`
  # does. macOS doesn't take a tag.
  WAILS_TAGS=()
  case "$(uname -s)" in
    Linux) WAILS_TAGS=(-tags webkit2_4_1) ;;
    Darwin) ;;
    *)
      echo "[tour-test] wails dev needs macOS or Debian/Ubuntu host (no display surface elsewhere)" >&2
      exit 1
      ;;
  esac

  cat <<EOF

──────────────────────────────────────────────────────────────────
[tour-test] launching wails dev against an isolated data dir
  Data dir:  $ISOLATED_DIR
  Wails IPC: :34115  (default)
  Vite dev:  :5173   (default)
──────────────────────────────────────────────────────────────────

✓ When the Wails window opens, the tour auto-fires if this WebView
  profile has no recall.onboardingCompleted='true' on record.

  To re-trigger after a previous dismissal:

    1. Right-click anywhere in the Recall window → "Inspect Element"
       (Wails dev mode enables WebView DevTools by default).
    2. In the Console:
         > localStorage.removeItem('recall.onboardingCompleted')
         > location.reload()
    3. The next paint walks the tour fresh, with the demo-data
       overlay populating the dossier + matches list.

  The tour reads recall.onboardingCompleted; if it's missing or
  not literally "true", it auto-opens. Skip / Done / Esc all
  write "true". The flag lives in the WebView, never the server.

Press Ctrl+C to stop wails dev and clean the isolated data dir.

EOF

  # HOME also points at the isolated dir so any settings.json /
  # WebView storage that ends up under the platform user-config
  # path lands inside the temp tree.
  HOME="$ISOLATED_DIR" RECALL_DATA_DIR="$ISOLATED_DIR" \
    wails dev "${WAILS_TAGS[@]}" &
  CHILD_PID=$!
  wait "$CHILD_PID"
  exit 0
fi

# ─── serveronly mode (browser-based smoke) ────────────────────────

mkdir -p "$(dirname "$SERVER_BINARY")"

echo "[tour-test] building frontend bundle…"
if ! (cd frontend && npm run build > /dev/null 2>&1); then
  echo "[tour-test] frontend build FAILED — running again with output for triage:" >&2
  (cd frontend && npm run build) || exit 1
fi

echo "[tour-test] building serveronly binary…"
if ! go build -tags serveronly -o "$SERVER_BINARY" .; then
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

HOME="$ISOLATED_DIR" RECALL_DATA_DIR="$ISOLATED_DIR" RECALL_SERVER_ADDR="127.0.0.1:$PORT" \
  "$SERVER_BINARY" &
CHILD_PID=$!

sleep 1
if ! kill -0 "$CHILD_PID" 2>/dev/null; then
  echo "[tour-test] server died on startup — aborting." >&2
  exit 1
fi

cat <<EOF

✓ Server is up. Two ways to see a FRESH tour in your browser:

  1. Open an INCOGNITO / PRIVATE window and visit:
        $URL
     Cleanest path — incognito has empty localStorage so the tour
     gate fires on first paint, no reset needed.

  2. Open $URL in your normal browser. If you've already dismissed
     the tour, open DevTools (F12) and run:
        > localStorage.removeItem('recall.onboardingCompleted')
        > location.reload()

The tour reads recall.onboardingCompleted; if it's missing or
not literally "true", it auto-opens. Skip / Done / Esc all write
"true". The flag lives in YOUR browser, never the server.

Press Ctrl+C to stop the server and clean the isolated data dir.

EOF

wait "$CHILD_PID"
