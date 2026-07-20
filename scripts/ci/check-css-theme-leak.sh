#!/usr/bin/env bash
# scripts/ci/check-css-theme-leak.sh — assert no theme-scoped CSS rule
# leaked into a bare `<html>`-matching selector, and that no rule targets
# a theme mode the app never sets.
#
# Why this script exists
# ----------------------
# Vue's compiler miscompiles the PARTIAL `:global(X) .y { … }` form inside
# a `<style scoped>` block: it drops the `.y` and emits a bare `X { … }`.
# So a rule written as
#
#     :global([data-theme="day"]) .status-bar { background: var(--surface-2) }
#
# ships as
#
#     [data-theme=day]{background:var(--surface-2)}
#
# which matches <html> itself and repaints the WHOLE page the moment that
# component mounts — and scoped <style> tags persist in <head> after the
# component unmounts, so the pollution is permanent for the session.
#
# frontend/CLAUDE.md documented a manual guard for this:
#
#     grep -c '^\[data-theme=light\]{' dist/assets/*.css
#
# but that grep is anchored with `^` while Vite emits MINIFIED, single-line
# CSS — the selector is essentially never at the start of a line, so the
# guard reported 0 forever while two real leaks sat in the shipped bundle.
# This script replaces it with an unanchored, structural check.
#
# Two distinct assertions
# -----------------------
#   1. LEAK — a bare `[data-theme=X]{…}` block (no descendant/compound
#      part after the attribute selector) whose body declares anything
#      other than custom properties. The palette blocks in themes.css are
#      legitimately bare and legitimately match <html> — that is how the
#      theme is applied — but they only ever set `--*` variables. A bare
#      block setting `color` / `background` / `box-shadow` is a miscompile.
#
#   2. DEAD MODE — a rule targeting a theme string the app never writes.
#      useTheme.applyTheme only ever sets day|dark|night|high-contrast;
#      "light" is a LEGACY STORED value that parseTheme migrates to "day"
#      on read. A `[data-theme="light"]` rule therefore can never match,
#      which silently strands whatever styling it was meant to provide.
#
# Usage:
#   bash scripts/ci/check-css-theme-leak.sh           # assume frontend/dist/ exists
#   bash scripts/ci/check-css-theme-leak.sh --build   # run `npm run build` first

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="${REPO_ROOT}/frontend/dist/assets"

# The theme modes useTheme.applyTheme can actually write. Keep in sync
# with ThemeMode in frontend/src/composables/shared/useTheme.ts.
VALID_MODES=(day dark night high-contrast)

if [[ "${1:-}" == "--build" ]]; then
  # Build into a PID-suffixed staging dir rather than frontend/dist —
  # lefthook runs pre-push hooks in parallel and vite empties its outDir
  # at start, which would race any concurrent hook compiling the
  # `//go:embed all:frontend/dist` directive. Mirrors check-bundle-size.sh.
  STAGE_DIR="/tmp/recall-themeleak-stage-$$"
  trap 'rm -rf "$STAGE_DIR"' EXIT
  echo "==> building frontend into ${STAGE_DIR} (staged)…"
  npm --prefix "${REPO_ROOT}/frontend" run build -- --outDir "$STAGE_DIR" --emptyOutDir >/dev/null
  DIST_DIR="${STAGE_DIR}/assets"
fi

if [[ ! -d "${DIST_DIR}" ]]; then
  echo "::error::frontend/dist/assets/ not found — run with --build or build first" >&2
  exit 1
fi

fail=0

# ─── 1. Bare theme selectors carrying non-custom-property declarations ───
#
# Match `[data-theme=X]{…}` where `{` follows `]` IMMEDIATELY — that is
# what makes it bare. A correctly-written `[data-theme=day] .foo{…}` has a
# descendant part between them and is skipped by the pattern.
while IFS= read -r hit; do
  [[ -z "${hit}" ]] && continue
  file="${hit%%:*}"
  rule="${hit#*:}"
  body="${rule#*\{}"
  body="${body%\}}"

  # Legitimate palette block: every declaration is a custom property.
  # Split on ';' and look for any declaration whose property doesn't
  # start with '--'. Values can contain ';'-free functions like
  # rgb(0 0 0 / 20%), so a naive split is sufficient here.
  leaked=""
  IFS=';' read -ra decls <<<"${body}"
  for decl in "${decls[@]}"; do
    [[ -z "${decl// /}" ]] && continue
    prop="${decl%%:*}"
    prop="${prop// /}"
    if [[ "${prop}" != --* ]]; then
      leaked="${leaked}${prop} "
    fi
  done

  if [[ -n "${leaked}" ]]; then
    echo "::error::Theme rule leaked to a bare <html> selector in $(basename "${file}"): ${rule:0:120}" >&2
    echo "         Offending declarations: ${leaked}" >&2
    echo "         Cause: the ':global([data-theme=…]) .foo' form inside <style scoped> miscompiles —" >&2
    echo "         Vue drops the '.foo' and emits a bare selector matching <html>." >&2
    echo "         Fix: move the rule into frontend/src/styles/*.css under a parent id," >&2
    echo "         e.g. [data-theme=\"day\"] #panel-ingest .foo { … }" >&2
    fail=1
  fi
done < <(grep -oHE '\[data-theme=[^]]+\]\{[^}]*\}' "${DIST_DIR}"/*.css 2>/dev/null || true)

# ─── 2. Rules targeting a theme mode the app never sets ───
#
# Build an alternation of the valid modes and report any data-theme value
# outside it. Quotes are stripped by the minifier, so match bare words.
valid_alt="$(
  IFS='|'
  echo "${VALID_MODES[*]}"
)"
while IFS= read -r mode; do
  [[ -z "${mode}" ]] && continue
  if [[ ! "${mode}" =~ ^(${valid_alt})$ ]]; then
    echo "::error::Dead theme selector [data-theme=${mode}] — useTheme.applyTheme only ever writes: ${VALID_MODES[*]}" >&2
    echo "         This rule can never match, so whatever it styles is silently unstyled." >&2
    echo "         Legacy values like \"light\" are migrated to a current mode by parseTheme on READ;" >&2
    echo "         they are never written to the DOM. Retarget the rule at a current mode or delete it." >&2
    grep -lE "\[data-theme=[\"']?${mode}[\"']?\]" "${DIST_DIR}"/*.css 2>/dev/null \
      | while IFS= read -r f; do echo "         seen in: $(basename "${f}")" >&2; done
    fail=1
  fi
done < <(grep -ohE '\[data-theme=[^]]+\]' "${DIST_DIR}"/*.css 2>/dev/null \
  | sed -E 's/.*=//; s/\]$//; s/["'"'"']//g' | sort -u)

if [[ "${fail}" -eq 0 ]]; then
  echo "CSS theme check: no bare-selector leaks, no dead theme modes."
fi
exit "${fail}"
