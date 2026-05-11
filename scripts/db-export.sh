#!/usr/bin/env bash
# Dump every record as newline-delimited JSON to stdout.
# Each line: {"id":..., "source_file":"...", ...the data fields...}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$SCRIPT_DIR/../data/db/owmetrics.db"

sqlite3 "$DB" "
  SELECT json_patch(
    json_object('id', id, 'source_file', source_file),
    data
  )
  FROM match_results
  ORDER BY id;
"
