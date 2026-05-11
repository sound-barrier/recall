#!/usr/bin/env bash
# Delete one record by id or by source_file substring.
#   db-delete.sh <id-or-source-file-substring>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$SCRIPT_DIR/../data/db/owmetrics.db"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <id|source-file-substring>"
  exit 2
fi

query=$1
if [[ "$query" =~ ^[0-9]+$ ]]; then
  where="id = $query"
else
  where="source_file LIKE '%${query//\'/\'\'}%'"
fi

matches=$(sqlite3 "$DB" "SELECT id || ' ' || source_file FROM match_results WHERE $where;")
if [[ -z "$matches" ]]; then
  echo "no match for: $query"
  exit 1
fi

echo "Will delete:"
printf '  %s\n' "$matches"
read -r -p "Confirm? [y/N] " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "aborted"; exit 0; }

sqlite3 "$DB" "DELETE FROM match_results WHERE $where;"
echo "deleted."
