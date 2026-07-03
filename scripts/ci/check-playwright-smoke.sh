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

# Build the whole harness inside an isolated git worktree of HEAD so
# this hook never touches the main tree's frontend/dist: lefthook
# runs pre-push hooks in parallel, and any in-place mutation of dist
# races a concurrent lint-go-full / coverage hook compiling
# `//go:embed all:frontend/dist` — vite's empty-at-start left the dir
# empty ("contains no embeddable files"), and even a file-by-file
# rsync swap changed the hashed filenames between the embed's glob
# and its opens ("open …: no such file or directory"). HEAD is
# exactly the content being pushed; node_modules rides in as a
# symlink since a worktree checkout doesn't carry it.
WORKTREE=$E2E_DIR/tree
REPO_ROOT=$(pwd)
git worktree remove --force "$WORKTREE" 2>/dev/null || true
git worktree add --force --detach "$WORKTREE" HEAD >/dev/null
trap 'cd "$REPO_ROOT" && git worktree remove --force "$WORKTREE" 2>/dev/null || true' EXIT
ln -sfn "$REPO_ROOT/frontend/node_modules" "$WORKTREE/frontend/node_modules"

echo "[playwright-smoke] Building frontend/dist (isolated worktree)…"
(cd "$WORKTREE/frontend" && npm run build >/dev/null)

echo "[playwright-smoke] Building serveronly binary…"
(cd "$WORKTREE" && go build -tags serveronly -o "$BIN" .)

echo "[playwright-smoke] Running smoke subset…"
# `--grep` matches the test title OR describe-block; specs paired
# with the user-visible affordance they cover. The list grows when
# a new spec earns a smoke designation (or carries an `@smoke` tag).
#
# Expansion criteria (post-1.0):
#   1. Spec earned its slot by FLAKING CI inside the prior month —
#      catching it pre-push beats catching it on the PR.
#   2. Spec covers a load-bearing seam that other specs depend on
#      (first-run, profiles, narrow selector swap) — a regression
#      here cascades across the whole suite.
#   3. Spec covers a 1.0 contract added in PRs #249-#268 that
#      didn't exist when the smoke list was first drawn.
#
# The smoke set targets ≤90s on a warm cache (was ≤60s pre-
# expansion; the trade-off is worth catching the regression class
# earlier in the workflow).
#
# E2E_PORT=7098 — the lefthook schemathesis hook runs in parallel
# (lefthook.yml has parallel: true on pre-push) and binds 7099. Use
# a sibling port so the two hooks don't collide; playwright.config.ts
# honors the env override.
cd frontend
CI=1 E2E_PORT=7098 npx playwright test \
  --grep '@smoke|update-check|unknown-delete|onboarding-tour-spotlight|leaf-virtualization|keyboard-shortcuts|smoke|a11y|first-run-modal|profile-delete-and-first-run|multiple-profiles|match-search|match-tags|narrow-rail|export-bundle|match-bulk-hide-drawer|ambiguous-attribution|ux-first-run-and-error-states'
