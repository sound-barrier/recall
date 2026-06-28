#!/usr/bin/env bash
# Boot Recall against an isolated data dir + a fresh WebView
# localStorage so you can repeatedly walk the first-launch
# onboarding tour without touching your real settings, real
# matches, or your normal browser's tour-completed flag.
#
# How the tour decides "new user":
#
#   useOnboardingTour reads the BROWSER / WebView localStorage key
#   `recall.onboardingCompleted` on mount. If it's missing or the
#   value isn't the literal string "true", the tour opens. Skip /
#   Finish / Escape all write "true" to that key, so the tour
#   stays dismissed across reloads for the lifetime of that
#   browser-profile + origin (or WebView profile) pair.
#
#   The flag lives in the browser / WebView, NEVER the server.
#   Wiping settings.json + the SQLite DB does NOT reset the tour
#   — the tour decision never round-trips to the API.
#
# Why this script wipes WebView storage:
#
#   `wails3 dev` runs unsandboxed, so the WebView ignores $HOME and
#   reads from NSHomeDirectory() (macOS) / XDG_*_HOME (Linux). Just
#   setting RECALL_DATA_DIR to an isolated path doesn't redirect
#   WKWebView's WebsiteData. The actual paths used:
#
#     macOS:   ~/Library/WebKit/com.sound-barrier.recall/WebsiteData/
#     Linux:   ~/.local/share/Recall/  (webkitgtk default)
#
#   The script removes those locations before launching so the
#   first paint of the WebView always lands on a fresh
#   localStorage and the tour gate fires. `--keep-webview-state`
#   skips the wipe if you want to test "user with the tour
#   already dismissed" behaviour.
#
# Two modes:
#
#   --mode=wails  (default — your primary dev path)
#       Runs `wails3 dev` against an isolated RECALL_DATA_DIR + a
#       just-wiped WebView. Hot-reload is on; the Wails window
#       opens on its own. If the tour STILL doesn't pop up,
#       open DevTools (right-click → Inspect Element), then in
#       the Console:
#         > localStorage.getItem('recall.onboardingCompleted')
#       If that returns "true", the wipe missed your WebView's
#       path; clear it manually with:
#         > localStorage.removeItem('recall.onboardingCompleted')
#         > location.reload()
#       and tell me which path your WebView is using so this
#       script can target it.
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
#   scripts/tour-test.sh                       # wails, fresh WebView
#   scripts/tour-test.sh --keep-webview-state  # wails, retain WebView
#   scripts/tour-test.sh --mode=server         # serveronly + browser
#   scripts/tour-test.sh --mode=server --port=7102
#   scripts/tour-test.sh --keep                # retain isolated data dir
#
# `set -u` so unset env references fail loudly. Not `-e`; the
# trap-based cleanup needs the script to keep running through a
# failed sub-step so the temp dir + processes still get torn down.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# This script lives at scripts/, so the repo root is one level up.
# Getting this wrong sends `cd "$REPO_ROOT"` somewhere `wails3 dev`
# can't find build/config.yml.
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="wails"
PORT=7100
KEEP_DATA=0
KEEP_WEBVIEW=0

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
    --keep-webview-state)
      KEEP_WEBVIEW=1
      ;;
    -h | --help)
      sed -n '1,/^set -u$/ p' "$0"
      exit 0
      ;;
    *)
      echo "[tour-test] unknown arg: $arg" >&2
      echo "[tour-test] usage: $0 [--mode={wails,server}] [--port=N] [--keep] [--keep-webview-state]" >&2
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
    # wails3 dev forks a chain of children (vite + go build + the
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

# wipe_webview_storage clears the Wails WebView's persistent storage
# so the next `wails3 dev` launch hits a fresh localStorage and the
# tour gate fires. The bundle id (com.sound-barrier.recall, from
# build/config.yml's productIdentifier) is the key WKWebView (macOS) /
# webkitgtk (Linux) use to scope the WebView's persistent storage.
#
# WKWebView keeps storage at ~/Library/WebKit/<bundle-id>/WebsiteData/.
# webkitgtk under Wails dev keeps storage at
# ~/.local/share/<ProjectName>/ but the exact subtree depends on the
# Wails release; we delete the whole tree and let Wails rebuild it.
# The deletion takes localStorage AND IndexedDB AND cookies — there
# is no "just localStorage" affordance through the OS APIs.
#
# Returns 0 on success or no-op (path not present yet). Prints which
# path(s) it touched so the user can see what got wiped.
wipe_webview_storage() {
  local touched=0
  local real_home
  real_home="$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6)"
  if [ -z "$real_home" ]; then
    # Fallback for macOS where `getent passwd` doesn't exist.
    real_home="$(eval echo "~$(id -un)")"
  fi

  case "$(uname -s)" in
    Darwin)
      # The v3 dev bundle id is com.sound-barrier.recall (build/config.yml
      # productIdentifier + build/darwin/Info.dev.plist's CFBundleIdentifier).
      # The old v2 ids (com.wails.Recall / com.wails.OWMetrics) are wiped
      # defensively so a stale tree from before the rename can't shadow the
      # fresh launch.
      local mac_id mac_path
      for mac_id in com.sound-barrier.recall com.wails.Recall com.wails.OWMetrics; do
        mac_path="$real_home/Library/WebKit/$mac_id"
        if [ -d "$mac_path" ]; then
          rm -rf "$mac_path"
          echo "[tour-test] wiped WKWebView storage: $mac_path"
          touched=1
        fi
      done
      ;;
    Linux)
      # webkitgtk + Wails on Linux: storage lives in
      # ~/.local/share/<ProjectName>/ (or $XDG_DATA_HOME if set).
      local data_root="${XDG_DATA_HOME:-$real_home/.local/share}"
      local linux_path="$data_root/Recall"
      if [ -d "$linux_path" ]; then
        rm -rf "$linux_path"
        echo "[tour-test] wiped webkitgtk storage: $linux_path"
        touched=1
      fi
      # Cache too — some webkitgtk builds keep localStorage under cache.
      local cache_root="${XDG_CACHE_HOME:-$real_home/.cache}"
      local linux_cache="$cache_root/Recall"
      if [ -d "$linux_cache" ]; then
        rm -rf "$linux_cache"
        echo "[tour-test] wiped webkitgtk cache: $linux_cache"
        touched=1
      fi
      ;;
    *)
      echo "[tour-test] WebView wipe: unsupported OS '$(uname -s)' — skipping" >&2
      ;;
  esac

  if [ "$touched" = "0" ]; then
    echo "[tour-test] WebView storage was already empty (no paths to wipe)"
  fi
}

# ─── wails3 dev mode (default) ─────────────────────────────────────
if [ "$MODE" = "wails" ]; then
  if ! command -v wails3 >/dev/null 2>&1; then
    cat <<'EOF' >&2
[tour-test] `wails3` CLI not on PATH.
  Install it (the repo pins it in mise.toml):
      mise install
  or directly:
      go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha2.107
  Then re-run, or use --mode=server for a browser-based smoke test.
EOF
    exit 1
  fi

  # v3 needs no build tag — GTK4 + webkitgtk-6.0 is the default Linux webview
  # (the v2 webkit2_4_1 tag is gone). Just gate on a host with a display surface.
  case "$(uname -s)" in
    Darwin | Linux) ;;
    *)
      echo "[tour-test] wails3 dev needs macOS or Debian/Ubuntu host (no display surface elsewhere)" >&2
      exit 1
      ;;
  esac

  # Wipe the WebView's persistent storage BEFORE launching wails3 dev
  # so the next first-paint of the WebView sees empty localStorage
  # and the tour gate fires. --keep-webview-state opts out for the
  # "user with the tour already dismissed" case.
  if [ "$KEEP_WEBVIEW" = "0" ]; then
    wipe_webview_storage
  else
    echo "[tour-test] retaining WebView state (--keep-webview-state)"
  fi

  cat <<EOF

──────────────────────────────────────────────────────────────────
[tour-test] launching wails3 dev against an isolated data dir
  Data dir:  $ISOLATED_DIR
  Vite dev:  :9245
──────────────────────────────────────────────────────────────────

✓ The Wails window will open with a fresh WebView. The tour
  auto-fires on first paint because recall.onboardingCompleted
  is no longer set.

  If the tour still doesn't open, the wipe missed your WebView's
  storage location. Open DevTools (right-click → Inspect Element)
  and run:
      > localStorage.getItem('recall.onboardingCompleted')
  If that returns "true", manually clear:
      > localStorage.removeItem('recall.onboardingCompleted')
      > location.reload()
  Then tell me which path your WebView is using (DevTools →
  Application → Local Storage) so this script can target it.

  The tour reads recall.onboardingCompleted; if it's missing or
  not literally "true", it auto-opens. Skip / Done / Esc all
  write "true". The flag lives in the WebView, never the server.

Press Ctrl+C to stop wails3 dev and clean the isolated data dir.

EOF

  # HOME also points at the isolated dir so any settings.json /
  # WebView storage that ends up under the platform user-config
  # path lands inside the temp tree.
  HOME="$ISOLATED_DIR" RECALL_DATA_DIR="$ISOLATED_DIR" \
    wails3 dev -config ./build/config.yml &
  CHILD_PID=$!
  wait "$CHILD_PID"
  exit 0
fi

# ─── serveronly mode (browser-based smoke) ────────────────────────

mkdir -p "$(dirname "$SERVER_BINARY")"

echo "[tour-test] building frontend bundle…"
if ! (cd frontend && npm run build >/dev/null 2>&1); then
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
