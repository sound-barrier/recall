#!/usr/bin/env bash
set -euo pipefail

DB="$HOME/Library/Application Support/OWMetrics/owmetrics.db"

if [[ ! -f "$DB" ]]; then
  echo "No database found at $DB"
  exit 0
fi

before=$(sqlite3 "$DB" "SELECT COUNT(*) FROM match_results;")
sqlite3 "$DB" "DELETE FROM match_results; VACUUM;"
echo "Cleared $before row(s) from match_results."
