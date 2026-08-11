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
# The third check covers what stylelint structurally CANNOT: the plugin
# early-returns on any property matching /^(?:@|\$|--)/, so a custom-property
# declaration holding a raw literal is invisible to it and no config can
# change that. Left open, it is also the laundering route — park a literal in
# a local `--x`, then spend it as `var(--x)`, which every other check waves
# through.
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
defined=$(grep -rhoE '(^|[{;[:space:]])--[a-z0-9-]+[[:space:]]*:' "$SRC" \
  --include='*.css' --include='*.vue' \
  | sed -E 's/.*(--[a-z0-9-]+).*/\1/' | sort -u)

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

# stylelint CANNOT do this one. declaration-strict-value early-returns on any
# property matching /^(?:@|\$|--)/, so a custom-property DECLARATION holding a
# raw literal is invisible to it, and that is not configurable. It is also the
# loophole by which a literal could be laundered into a local --x and then
# spent as var(--x), which every other check would wave through.
#
# Literals are CORRECT in the palette definition files — that is what they are
# for — and in the Appearance swatches, which must paint the OTHER themes'
# colors and so cannot use the current theme's tokens.
# `(^|[{;[:space:]])` rather than `^[[:space:]]*`: a declaration written
# inline — `.x { --y: #fff; }` — is not at the start of its line, and the
# anchored form waved it through. A comma precedes the fallback in
# `var(--a, #fff)`, so that shape still cannot match.
echo "==> checking custom-property declarations outside the palette files"
literal_decls=$(grep -rnE '(^|[{;[:space:]])--[a-z0-9-]+[[:space:]]*:[[:space:]]*(#[0-9a-fA-F]{3,8}|rgba?\([[:space:]]*[0-9.]|hsla?\([[:space:]]*[0-9.])' \
  "$SRC" --include='*.css' --include='*.vue' \
  | grep -vE '/styles/(tokens|themes)\.css:' \
  | grep -vE '/settings/SettingsAppearance\.vue:' || true)

if [ -n "$literal_decls" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    echo "  ✗ ${line}"
    echo "      a raw literal belongs in styles/tokens.css or styles/themes.css"
    fail=1
  done <<<"$literal_decls"
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "CSS token check FAILED."
  echo "  - An undefined token means the fallback is silently doing the work."
  echo "  - A fallback on a defined token is dead code that invites drift."
  echo "  - A literal in a custom property is a palette value hiding outside"
  echo "    the palette, where no linter can see it."
  exit 1
fi

echo "CSS token check: every var() resolves, no dead fallbacks, no stray literals."
