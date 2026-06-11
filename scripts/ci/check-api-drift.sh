#!/usr/bin/env bash
# scripts/ci/check-api-drift.sh — fuzz the live server against api/openapi.yaml
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
#   bash scripts/ci/check-api-drift.sh                          # default
#   RECALL_SCHEMATHESIS_PORT=7100 bash scripts/ci/check-api-drift.sh
#   RECALL_SCHEMATHESIS_TIMEOUT=60 bash scripts/ci/check-api-drift.sh
#
# Prerequisites:
#   - Go on PATH (for `go build`)
#   - schemathesis 4.x on PATH. Pin in tool-versions.env (SCHEMATHESIS_VERSION).
#       . ./tool-versions.env && pipx install "schemathesis==${SCHEMATHESIS_VERSION}"
#   - frontend/dist/ present (for //go:embed in main.go). The script
#     builds it if missing; pass SKIP_FRONTEND_BUILD=1 to bypass.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Source the central version pin (informational only — script-level
# behavior matches whatever schemathesis the dev has installed via
# pipx). CI and initialize.sh pin to this exact version.
# shellcheck source=../../tool-versions.env disable=SC1091
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
#                                     All previously-excluded checks
#                                     (positive_data_acceptance,
#                                     unsupported_method,
#                                     missing_required_header,
#                                     use_after_free,
#                                     ensure_resource_availability) are
#                                     now enabled. The `transfers` and
#                                     `active` literal paths got
#                                     explicit 405 stubs (see
#                                     pkg/cmd/server.go::methodNotAllowed).
#                                     Setter handlers map validation
#                                     failures to 409 instead of 400 so
#                                     positive_data_acceptance's
#                                     "spec-valid input → no 400"
#                                     contract holds.
#   --exclude-checks negative_data_rejection
#                                   — v4.21 intermittently flags
#                                     fully-valid query parameter
#                                     values as "schema-violating"
#                                     for DELETE /api/v1/matches
#                                     (?keep_ignored=true returning
#                                     204 is the documented happy
#                                     path; schemathesis classifies
#                                     it as a negative case and
#                                     demands 4xx). Repro: bash
#                                     scripts/ci/check-api-drift.sh
#                                     fails 4/5 runs on main with
#                                     this check enabled. We get
#                                     the negative-path coverage
#                                     from handcrafted Go tests
#                                     (TestServerMux_DeleteMatches_
#                                     RejectsMalformedQuery) which
#                                     cover unknown query keys,
#                                     malformed boolean values, and
#                                     the empty-value edge case
#                                     deterministically — the
#                                     fuzzer's contribution there
#                                     was duplicating that without
#                                     adding signal.
#   --suppress-health-check all     — covers the seed-quality health
#                                     checks. Schemathesis v4 promoted
#                                     filter_too_much to a hard error
#                                     when an operation can't generate
#                                     ANY valid examples (regression
#                                     vs the warning behavior in v3),
#                                     so the suppress flag alone isn't
#                                     enough for DELETE / PUT routes
#                                     whose path params carry tight
#                                     regex constraints — those paths
#                                     get explicit `--exclude-path`
#                                     entries below.
#   --exclude-path /api/v1/profiles/{name} — `name` carries a tight
#                                     regex that schemathesis can't
#                                     satisfy with random input;
#                                     filter_too_much fires as a hard
#                                     error in v4. Profile lifecycle
#                                     ops are tested in pkg/app/*_test.go.
#   --exclude-path /api/v1/events   — SSE endpoint, never closes; would
#                                     trip the request-response timeout.
#   --exclude-path /api/v1/system/data-update — POST hits live network
#                                     (GitHub Releases API for source=
#                                     release, GitHub Pages for source=
#                                     main). The fuzz environment has
#                                     neither reachable so source=main
#                                     calls reliably return 502 (Pages
#                                     unreachable) which schemathesis's
#                                     server_error check correctly flags
#                                     — the failure is environmental,
#                                     not a contract bug. Handler's
#                                     sentinel→status mapping is covered
#                                     by pkg/app/apply_data_update_test.go.
# DELETE methods are no longer excluded — the test server runs in an
# isolated HOME so a DB-wiping DELETE only resets the scratch state.
# OpenAPI 3.1 is first-class in v4 — no more --experimental flag.
echo "==> running schemathesis…"
schemathesis run \
  --url "http://127.0.0.1:$PORT" \
  --checks all \
  --exclude-checks negative_data_rejection \
  --max-examples 20 \
  --suppress-health-check all \
  --exclude-path /api/v1/events \
  --exclude-path '/api/v1/profiles/{name}' \
  --exclude-path '/api/v1/system/data-update' \
  api/openapi.yaml

echo "[ recall ] ✓  API spec ↔ server in sync"
