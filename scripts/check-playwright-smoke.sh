#!/usr/bin/env bash
# Playwright smoke subset for pre-push.
#
# Builds the frontend + serveronly binary the same way `make
# test-e2e` does, then runs a `--grep`-filtered subset of the
# Playwright suite. The grep list deliberately includes the specs
# that have flaked CI in the past day plus the always-must-pass
# `smoke.spec.ts` + `a11y.spec.ts`. Target: ≤60s on a warm cache.
#
# Skipped automatically if the system can't run headless Chrome
# (CI runners install Playwright's chromium; local devs may not).
# Honors LEFTHOOK_EXCLUDE=playwright-smoke; see lefthook.yml.

set -eu

E2E_DIR=/tmp/recall-e2e
BIN=$E2E_DIR/recall-server

# Honor a manual opt-out for slow networks / dev VMs.
if [ "${SKIP_E2E_SMOKE:-}" = "1" ]; then
  echo "[playwright-smoke] skipped (SKIP_E2E_SMOKE=1)"
  exit 0
fi

# Probe Playwright's chromium: if it's not installed, surface an
# actionable error rather than failing mid-run with a cryptic
# "executable doesn't exist" message.
if ! (cd frontend && npx playwright --version >/dev/null 2>&1); then
  echo "[playwright-smoke] Playwright not installed in frontend/."
  echo "  cd frontend && npm ci && npx playwright install chromium"
  exit 1
fi

mkdir -p "$E2E_DIR"

echo "[playwright-smoke] Building frontend/dist…"
(cd frontend && npm run build >/dev/null)

echo "[playwright-smoke] Building serveronly binary…"
go build -tags serveronly -o "$BIN" .

echo "[playwright-smoke] Running smoke subset…"
# `--grep` matches the test title OR describe-block; specs paired
# with the user-visible affordance they cover. The list grows when
# a new spec earns a smoke designation (or carries an `@smoke` tag).
#
# E2E_PORT=7098 — the lefthook schemathesis hook runs in parallel
# (lefthook.yml has parallel: true on pre-push) and binds 7099. Use
# a sibling port so the two hooks don't collide; playwright.config.ts
# honors the env override.
cd frontend
CI=1 E2E_PORT=7098 npx playwright test \
  --grep '@smoke|update-check|unknown-delete|onboarding-tour-spotlight|leaf-virtualization|keyboard-shortcuts|smoke|a11y'
