#!/usr/bin/env bash
# List every match_results row as a one-line summary.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$SCRIPT_DIR/../data/db/owmetrics.db"

if [[ ! -f "$DB" ]]; then
  echo "No database at $DB"
  exit 1
fi

sqlite3 -header -column "$DB" "
  SELECT
    id,
    source_file,
    json_extract(data, '\$.map')  AS map,
    json_extract(data, '\$.mode') AS mode,
    json_extract(data, '\$.hero') AS hero,
    json_extract(data, '\$.eliminations') || '/' ||
    json_extract(data, '\$.assists')     || '/' ||
    json_extract(data, '\$.deaths')       AS eliad
  FROM match_results
  ORDER BY id;
"
