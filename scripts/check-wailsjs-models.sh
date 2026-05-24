#!/usr/bin/env bash
# scripts/check-wailsjs-models.sh — verify that every Go struct field
# exposed to the Wails frontend has a matching entry in
# frontend/wailsjs/go/models.ts.
#
# Why this exists: wails dev regenerates wailsjs/ only on macOS, so a
# contributor on Linux/Windows who adds a field to (say) MatchRecord
# will not produce the corresponding TypeScript update. Server mode
# keeps working because api.ts goes through openapi-typescript types
# from the spec, but the desktop Wails build silently loses access to
# the new field. This script turns that silent failure into a CI gate.
#
# Strategy: for each struct in TRACKED_TYPES, extract its json:"…" tags
# from the Go source and assert each tag name appears as a field in
# the corresponding models.ts class.
#
# Adding a new exposed type: add the Go file + struct name to
# TRACKED_TYPES below and the matching `export class Foo` will be
# checked automatically.
#
# Usage: bash scripts/check-wailsjs-models.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODELS_TS="${ROOT}/frontend/wailsjs/go/models.ts"

if [ ! -f "${MODELS_TS}" ]; then
  printf 'error: %s does not exist (run wails dev on macOS to generate it)\n' \
    "${MODELS_TS}" >&2
  exit 1
fi

# Struct types exposed across the Wails boundary. Each entry:
#   <go-source-file>:<StructName>
# Add a new line here when introducing a new exposed type.
TRACKED_TYPES=(
  "pkg/app/app.go:MatchRecord"
  "pkg/app/app.go:UpdateInfo"
  "pkg/app/app.go:TesseractStatus"
  "pkg/parser/parser.go:MatchResult"
  "pkg/parser/parser.go:HeroSR"
  "pkg/parser/parser.go:HeroPlay"
  "pkg/parser/parser.go:Performance"
  "pkg/parser/parser.go:PerformanceStat"
)

# Extract `json:"name[,opts]"` tag names from a single struct
# definition in a Go file. Awk scans from `type Foo struct {` to the
# closing `}` and prints the bare name (before any `,omitempty`).
extract_json_tags() {
  local file="$1" struct="$2"
  awk -v struct="${struct}" '
    BEGIN { inside = 0 }
    $0 ~ "^type " struct " struct" { inside = 1; next }
    inside && /^}/ { inside = 0 }
    inside {
      if (match($0, /json:"[^"]+"/)) {
        tag = substr($0, RSTART + 6, RLENGTH - 7)
        sub(/,.*/, "", tag)
        print tag
      }
    }
  ' "${file}"
}

# Verify a tag name appears as a class field in models.ts. Looks for a
# `class StructName {` line and scans forward until the closing `}`
# for `tagname[?]:` or `tagname[?]:` patterns.
tag_in_class() {
  local class="$1" tag="$2"
  awk -v class="${class}" -v tag="${tag}" '
    BEGIN { inside = 0; found = 0 }
    $0 ~ "export class " class " {" { inside = 1; next }
    inside && /^	}/ { inside = 0 }
    inside {
      # Match  "tag:" or "tag?:"
      pattern = "^[[:space:]]+" tag "\\??:"
      if ($0 ~ pattern) { found = 1; exit }
    }
    END { exit (found ? 0 : 1) }
  ' "${MODELS_TS}"
}

missing=()
for entry in "${TRACKED_TYPES[@]}"; do
  file="${entry%:*}"
  struct="${entry#*:}"
  abs_file="${ROOT}/${file}"
  if [ ! -f "${abs_file}" ]; then
    printf 'error: %s does not exist\n' "${abs_file}" >&2
    exit 1
  fi
  while IFS= read -r tag; do
    [ -z "${tag}" ] && continue
    if ! tag_in_class "${struct}" "${tag}"; then
      missing+=("${struct}.${tag} (declared in ${file})")
    fi
  done < <(extract_json_tags "${abs_file}" "${struct}")
done

if [ ${#missing[@]} -eq 0 ]; then
  exit 0
fi

printf 'frontend/wailsjs/go/models.ts is missing fields:\n' >&2
for m in "${missing[@]}"; do
  printf '  %s\n' "$m" >&2
done
cat >&2 <<'EOF'

To fix:
  1. On macOS: `wails dev` regenerates wailsjs/ automatically.
  2. Off macOS: hand-edit frontend/wailsjs/go/models.ts to add the
     field (type + assignment in constructor) and the corresponding
     `app.go`/`parser.go` json tag. See CLAUDE.md → "Adding a field
     to an existing Go struct" for the full procedure.
EOF
exit 1
