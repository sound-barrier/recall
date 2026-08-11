#!/usr/bin/env bash
# scripts/ci/check-css-tokens.sh — assert every `var(--token)` names a custom
# property that actually exists, and that no `var(--token, fallback)` hides a
# token which is always defined anyway.
#
# Why this script exists
# ----------------------
# `var(--x, <fallback>)` fails SILENTLY. If `--x` does not exist, CSS quietly
# uses the fallback and nothing anywhere reports it — not the browser, not
# vue-tsc, and not stylelint. `declaration-strict-value` cannot help either:
# it is satisfied the moment it sees a `var(`, so it never inspects the token
# name or the fallback behind it.
#
# That blind spot shipped two real bugs. Both were headings meant to carry the
# Big Noodle display face:
#
#     font-family: var(--display-font, inherit)     # IgnoredFilesPanel
#     font-family: var(--font-display, var(--mono)) # unknown.css
#
# Neither token has ever existed — the real one is `--display` — so both
# rendered in the inherited/mono face instead, and looked deliberate. The
# same class of defect had already been found once before: `--neutral` lived
# for months as nothing but a hardcoded `var(--neutral, #95a5a6)` fallback,
# which is why tokens.css now carries a comment about it.
#
# The second check exists because a fallback on an always-defined token is
# dead code that reads as a live decision. It invites drift: `--loss` carried
# a stale `#e74c3c` fallback that is not `--loss` in ANY theme, so anyone
# reading it learned the wrong palette value.
#
# Two escapes, both deliberate:
#   * A token set at runtime via an inline `:style` binding is genuinely
#     absent from the stylesheets, so its fallback IS the default. Those are
#     listed in RUNTIME_TOKENS below.
#   * `var(--x, var(--y))` inside styles/tokens.css itself is a token
#     definition chain, not a consumer.

set -euo pipefail

cd "$(dirname "$0")/../.."
SRC="frontend/src"

# Custom properties assigned by a Vue `:style` binding rather than a
# stylesheet. Their fallback is the real default and must stay.
RUNTIME_TOKENS="--card-i --ct-heat-volume"

fail=0

# Every custom property DEFINED anywhere in the frontend sources.
defined=$(grep -rhoE '^[[:space:]]*--[a-z0-9-]+[[:space:]]*:' "$SRC" \
  --include='*.css' --include='*.vue' \
  | tr -d ' \t:' | sort -u)

# Every custom property REFERENCED through var().
refs=$(grep -rnoE 'var\([[:space:]]*--[a-z0-9-]+' "$SRC" \
  --include='*.css' --include='*.vue' \
  | sed -E 's/var\([[:space:]]*/ /' | sort -u)

echo "==> checking var() references against defined tokens"
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  loc=${ref%% *}
  tok=${ref##* }
  case " $RUNTIME_TOKENS " in *" $tok "*) continue ;; esac
  if ! grep -qx -- "$tok" <<<"$defined"; then
    echo "  ✗ $loc references $tok, which is never defined"
    fail=1
  fi
done <<<"$refs"

echo "==> checking for fallbacks on always-defined tokens"
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  loc=${hit%%:var(*}
  tok=$(sed -E 's/.*var\([[:space:]]*(--[a-z0-9-]+).*/\1/' <<<"$hit")
  case " $RUNTIME_TOKENS " in *" $tok "*) continue ;; esac
  # A definition chain inside tokens.css is not a consumer.
  case "$loc" in */styles/tokens.css:*) continue ;; esac
  if grep -qx -- "$tok" <<<"$defined"; then
    echo "  ✗ $loc: var($tok, …) — $tok is always defined, so the fallback is dead"
    fail=1
  fi
done <<<"$(grep -rnoE 'var\([[:space:]]*--[a-z0-9-]+[[:space:]]*,' "$SRC" \
  --include='*.css' --include='*.vue' || true)"

if [ "$fail" -ne 0 ]; then
  echo
  echo "CSS token check FAILED."
  echo "  - An undefined token means the fallback is silently doing the work."
  echo "  - A fallback on a defined token is dead code that invites drift."
  exit 1
fi

echo "CSS token check: every var() resolves, no dead fallbacks."
