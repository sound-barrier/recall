#!/usr/bin/env bash
# Show one record's full JSON, pretty-printed.
#   db-show.sh <id-or-match-key-or-source-file-substring>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$SCRIPT_DIR/../data/db/owmetrics.db"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <id|match-key|source-file-substring>"
  exit 2
fi

query=$1
if [[ "$query" =~ ^[0-9]+$ ]]; then
  where="id = $query"
elif [[ "$query" == *:* ]]; then
  where="match_key = '${query//\'/\'\'}'"
else
  where="source_files LIKE '%${query//\'/\'\'}%'"
fi

# Rebuild a single JSON document per row from the explicit columns; embed
# heroes_played and performance via json() so they parse as objects rather
# than strings. Pipe through jq if available for pretty printing.
raw=$(sqlite3 "$DB" "
  SELECT id || char(9) || match_key || char(9) || json_object(
    'source_files', json(source_files),
    'map',          map,
    'type',         type,
    'mode',         mode,
    'role',         role,
    'hero',         hero,
    'eliminations', eliminations,
    'assists',      assists,
    'deaths',       deaths,
    'damage',       damage,
    'healing',      healing,
    'mitigation',   mitigation,
    'result',       result,
    'final_score',  final_score,
    'date',         date,
    'finished_at',  finished_at,
    'game_length',  game_length,
    'heroes_played', CASE WHEN heroes_played IS NULL THEN NULL ELSE json(heroes_played) END,
    'performance',   CASE WHEN performance   IS NULL THEN NULL ELSE json(performance)   END
  )
  FROM match_results WHERE $where ORDER BY id;
")

if [[ -z "$raw" ]]; then
  echo "no match for: $query"
  exit 1
fi

while IFS=$'\t' read -r id key data; do
  echo "── id=$id  match_key=$key"
  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$data" | jq .
  else
    printf '%s\n' "$data"
  fi
  echo
done <<< "$raw"
