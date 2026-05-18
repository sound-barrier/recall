#!/usr/bin/env bash
# List every match_results row as a one-line summary.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$SCRIPT_DIR/../data/db/recall.db"

if [[ ! -f "$DB" ]]; then
  echo "No database at $DB"
  exit 1
fi

sqlite3 -header -column "$DB" "
  SELECT
    id,
    match_key,
    COALESCE(map, '')                                  AS map,
    COALESCE(mode, '')                                 AS mode,
    COALESCE(hero, '')                                 AS hero,
    eliminations || '/' || assists || '/' || deaths    AS ead,
    damage || '/' || healing || '/' || mitigation      AS dhm,
    COALESCE(result, '')                               AS result,
    COALESCE(final_score, '')                          AS score,
    COALESCE(date, '')                                 AS date
  FROM match_results
  ORDER BY id;
"
