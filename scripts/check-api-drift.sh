#!/usr/bin/env bash
# scripts/check-api-drift.sh — fuzz the live server against api/openapi.yaml
# and fail on any contract drift (status code, content-type, response
# schema, response headers, server errors).
#
# Builds the serveronly binary, boots it on an isolated HOME +
# RECALL_DATA_DIR (so it doesn't trample the dev's real install),
# runs schemathesis, tears the server down. Same invocation as CI's
# `schemathesis` job — see .github/workflows/ci.yml. Centralised here
# so CI + lefthook + ad-hoc `make check-api-drift` all stay in sync.
#
# Usage:
#   bash scripts/check-api-drift.sh                          # default
#   RECALL_SCHEMATHESIS_PORT=7100 bash scripts/check-api-drift.sh
#   RECALL_SCHEMATHESIS_TIMEOUT=60 bash scripts/check-api-drift.sh
#
# Prerequisites:
#   - Go on PATH (for `go build`)
#   - schemathesis 4.x on PATH. Pin in tool-versions.env (SCHEMATHESIS_VERSION).
#       . ./tool-versions.env && pipx install "schemathesis==${SCHEMATHESIS_VERSION}"
#   - frontend/dist/ present (for //go:embed in main.go). The script
#     builds it if missing; pass SKIP_FRONTEND_BUILD=1 to bypass.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Source the central version pin (informational only — script-level
# behavior matches whatever schemathesis the dev has installed via
# pipx). CI and initialize.sh pin to this exact version.
# shellcheck source=../tool-versions.env disable=SC1091
. ./tool-versions.env

PORT=${RECALL_SCHEMATHESIS_PORT:-7099}
WAIT_TIMEOUT=${RECALL_SCHEMATHESIS_TIMEOUT:-30}

# ── Locate schemathesis ──────────────────────────────────────────────
# pipx installs binaries to ~/.local/bin (Linux/macOS). Many shells
# pick that up via `pipx ensurepath` writing into .bashrc/.zshrc, but
# the lefthook pre-push hook spawns a non-interactive shell that
# doesn't load profile rc files. Add ~/.local/bin to PATH defensively
# so the hook finds the same binary `make check-api-drift` does.
if [[ -d "$HOME/.local/bin" ]] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

# ── Prereq check ─────────────────────────────────────────────────────
if ! command -v schemathesis >/dev/null 2>&1; then
  cat >&2 <<EOF
::error::schemathesis not on PATH.

Install (pin from tool-versions.env):
  pipx install "schemathesis==${SCHEMATHESIS_VERSION}"

Or skip this check for one push:
  LEFTHOOK_EXCLUDE=schemathesis git push
EOF
  exit 1
fi

# ── Frontend dist (needed by //go:embed) ─────────────────────────────
if [[ -z "${SKIP_FRONTEND_BUILD:-}" ]]; then
  needs_build=0
  if [[ ! -d frontend/dist ]] || ! find frontend/dist -maxdepth 3 -name 'index*.js' -print -quit | grep -q .; then
    needs_build=1
  fi
  if [[ $needs_build -eq 1 ]]; then
    echo "==> building frontend/dist (required for //go:embed)…"
    npm --prefix frontend run build >/dev/null
  fi
fi

# ── Build serveronly binary into a temp location ─────────────────────
BUILD_DIR=$(mktemp -d -t recall-schemathesis-XXXXXX)
SERVER_BIN="$BUILD_DIR/recall-server"
TMP_HOME=$(mktemp -d -t recall-schemathesis-home-XXXXXX)
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    # Give it 2s to exit cleanly; SIGKILL if it lingers.
    for _ in 1 2; do
      if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    kill -9 "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$BUILD_DIR" "$TMP_HOME"
}
trap cleanup EXIT INT TERM

echo "==> building serveronly binary…"
go build -tags serveronly -o "$SERVER_BIN" .

# ── Boot the server ──────────────────────────────────────────────────
echo "==> booting server on 127.0.0.1:$PORT (HOME=$TMP_HOME)…"
HOME="$TMP_HOME" \
  RECALL_DATA_DIR="$TMP_HOME/data" \
  RECALL_SERVER_ADDR="127.0.0.1:$PORT" \
  "$SERVER_BIN" >"$BUILD_DIR/server.log" 2>&1 &
SERVER_PID=$!

up=0
for i in $(seq 1 "$WAIT_TIMEOUT"); do
  if curl -fsS "http://127.0.0.1:$PORT/api/v1/settings/tesseract" >/dev/null 2>&1; then
    echo "    ready after ${i}s"
    up=1
    break
  fi
  sleep 1
done

if [[ $up -ne 1 ]]; then
  echo "::error::server did not come up within ${WAIT_TIMEOUT}s" >&2
  echo "--- server.log ---" >&2
  tail -30 "$BUILD_DIR/server.log" >&2 || true
  exit 1
fi

# ── Run schemathesis ────────────────────────────────────────────────
# Schemathesis v4 flag conventions (CHANGED from v3 — kept here so
# the next reader doesn't have to dig through release notes):
#   --url (was --base-url)          — the live server's base URL.
#   --max-examples (was --hypothesis-max-examples) — caps wall time.
#   --checks all                    — every built-in compliance check.
#   --exclude-checks <list>         — disabled compliance checks. All
#                                     five are NEW in v4 and surface
#                                     known spec / server gaps in their
#                                     own dedicated PRs:
#                                       * positive_data_acceptance —
#                                         several setters accept lenient
#                                         JSON the spec tightens.
#                                       * unsupported_method — the
#                                         transfers + active path
#                                         segments collide with the
#                                         {matchKey} + {name} wildcards
#                                         on other verbs, so a DELETE
#                                         routes to the wildcard handler
#                                         instead of 405.
#                                       * missing_required_header,
#                                         use_after_free,
#                                         ensure_resource_availability —
#                                         not yet evaluated against this
#                                         API surface.
#                                     The v3-equivalent
#                                     negative_data_rejection (renamed
#                                     and broadened in v4 to cover null
#                                     in every typed field) IS enabled.
#   --exclude-method DELETE         — DELETE on collection routes would
#                                     wipe the live test server's state;
#                                     targeted unit tests cover those
#                                     endpoints instead.
#   --exclude-path /api/v1/events   — SSE endpoint, never closes; would
#                                     trip the request-response timeout.
# OpenAPI 3.1 is first-class in v4 — no more --experimental flag.
echo "==> running schemathesis…"
schemathesis run \
  --url "http://127.0.0.1:$PORT" \
  --checks all \
  --exclude-checks unsupported_method,positive_data_acceptance,missing_required_header,use_after_free,ensure_resource_availability \
  --max-examples 20 \
  --exclude-method DELETE \
  --exclude-path /api/v1/events \
  api/openapi.yaml

echo "[ recall ] ✓  API spec ↔ server in sync"
