#!/usr/bin/env bash
# Delete every row from every parent table (children CASCADE) and VACUUM.
# Equivalent to the "Clear Database" button in the Recall UI. No
# confirmation prompt — intended for development resets.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_db.sh
. "$SCRIPT_DIR/_db.sh"

DB=$(recall_db_path)
if [[ ! -f "$DB" ]]; then
  echo "No database at $DB"
  exit 0
fi

# Handle either the new 10-table schema or a pre-PR-#45 single-table DB:
# if `match_results` is still there, wipe it; otherwise wipe the new tables.
# Either way the file stays on disk so the app picks up the schema
# `CREATE … IF NOT EXISTS` on next launch.
if sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='match_results'" | grep -q match_results; then
  before=$(sqlite3 "$DB" "SELECT COUNT(*) FROM match_results")
  sqlite3 "$DB" "DELETE FROM match_results; VACUUM;"
  echo "Cleared $before row(s) from legacy match_results table."
  exit 0
fi

# New schema: count + delete each parent in one transaction so the totals
# print is accurate even if cascading deletes change row counts mid-flight.
counts=""
for t in $(parent_tables); do
  n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM $t" 2>/dev/null || echo 0)
  [[ "$n" -gt 0 ]] && counts+=" $t=$n"
done

sql="PRAGMA foreign_keys=ON; BEGIN;"
for t in $(parent_tables); do sql+=" DELETE FROM $t;"; done
sql+=" COMMIT; VACUUM;"
sqlite3 "$DB" "$sql"

if [[ -n "$counts" ]]; then
  echo "Cleared:${counts}"
else
  echo "DB was already empty."
fi
