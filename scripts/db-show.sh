#!/usr/bin/env bash
# Show one record's full JSON, pretty-printed.
#   db-show.sh <id-or-source-file-substring>
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

# Use json() to ensure pretty output; pipe through jq if it's installed.
raw=$(sqlite3 "$DB" "SELECT id || char(9) || source_file || char(9) || data
                     FROM match_results WHERE $where ORDER BY id;")

if [[ -z "$raw" ]]; then
  echo "no match for: $query"
  exit 1
fi

while IFS=$'\t' read -r id source data; do
  echo "── id=$id  source=$source"
  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$data" | jq .
  else
    printf '%s\n' "$data"
  fi
  echo
done <<< "$raw"
