#!/usr/bin/env bash
set -euo pipefail

# Resolve the project root from this script's location so it works no matter
# where you invoke it from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$SCRIPT_DIR/../data/db/owmetrics.db"

if [[ ! -f "$DB" ]]; then
  echo "No database found at $DB"
  exit 0
fi

before=$(sqlite3 "$DB" "SELECT COUNT(*) FROM match_results;")
sqlite3 "$DB" "DELETE FROM match_results; VACUUM;"
echo "Cleared $before row(s) from match_results."
