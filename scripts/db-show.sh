#!/usr/bin/env bash
# Show every per-screenshot-type row contributing to one match,
# children attached. Lookups:
#   db-show.sh match:2026-05-10T21:29:28   # exact match_key
#   db-show.sh 22.36.31.03                 # filename substring
#   db-show.sh rialto                      # map substring (SUMMARY rows)
# Each parent row is printed with its child rows nested so the dump
# mirrors what aggregateAll sees. Pipes through jq when available.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_db.sh
. "$SCRIPT_DIR/_db.sh"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <match-key|filename-substring|map-substring>" >&2
  exit 2
fi

DB=$(recall_db_path)
require_new_schema "$DB"

query=$1
esc=${query//\'/\'\'}

# Resolve to a set of match_keys.
if [[ "$query" == *:* ]]; then
  where_keys="match_key='$esc'"
else
  where_keys="filename LIKE '%$esc%'"
fi
keys=$(sqlite3 "$DB" "
  SELECT match_key FROM summary_screenshots    WHERE $where_keys
  UNION SELECT match_key FROM scoreboard_screenshots WHERE $where_keys
  UNION SELECT match_key FROM personal_screenshots   WHERE $where_keys
  UNION SELECT match_key FROM rank_screenshots       WHERE $where_keys
  UNION SELECT match_key FROM unknown_screenshots    WHERE $where_keys")
if [[ -z "$keys" && "$query" != *:* ]]; then
  keys=$(sqlite3 "$DB" "SELECT DISTINCT match_key FROM summary_screenshots WHERE lower(map) LIKE lower('%$esc%')")
fi
if [[ -z "$keys" ]]; then
  echo "no match for: $query" >&2
  exit 1
fi

pp() {
  if command -v jq >/dev/null 2>&1; then jq .; else cat; fi
}

# Each parent: (table-name, child-table, FK-column).
parents=(
  "summary_screenshots    summary_heroes_played  summary_screenshot_id"
  "scoreboard_screenshots scoreboard_hero_stats  scoreboard_screenshot_id"
  "personal_screenshots   personal_hero_stats    personal_screenshot_id"
  "rank_screenshots       rank_modifiers         rank_screenshot_id"
  "rank_screenshots       rank_sr                rank_screenshot_id"
  "unknown_screenshots    -                      -"
)

while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  esc_key=${key//\'/\'\'}
  printf '\n════ match_key=%s ════\n' "$key"

  for spec in "${parents[@]}"; do
    # shellcheck disable=SC2086  # word-splitting is intentional
    set -- $spec
    table=$1
    child=$2
    fk=$3
    parent_rows=$(sqlite3 -json "$DB" "SELECT * FROM $table WHERE match_key='$esc_key'" 2>/dev/null || echo "[]")
    [[ "$parent_rows" == "[]" || -z "$parent_rows" ]] && continue
    # Only print the parent label once even if multiple child tables hang off it (rank has two).
    printf '── %s' "$table"
    [[ "$child" != "-" ]] && printf '  (+ %s)' "$child"
    printf '\n'
    printf '%s\n' "$parent_rows" | pp
    if [[ "$child" != "-" ]]; then
      child_rows=$(sqlite3 -json "$DB" "
        SELECT c.* FROM $child c
        JOIN $table p ON p.id = c.$fk
        WHERE p.match_key='$esc_key'" 2>/dev/null || echo "[]")
      [[ "$child_rows" != "[]" && -n "$child_rows" ]] && {
        printf '  └ %s\n' "$child"
        printf '%s\n' "$child_rows" | pp
      }
    fi
  done
done <<<"$keys"
