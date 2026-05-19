#!/usr/bin/env bash
# Delete one record by id, match_key, or source-file substring.
#   db-delete.sh <id|match-key|source-file-substring>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$SCRIPT_DIR/../data/db/recall.db"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <id|match-key|source-file-substring>"
  exit 2
fi

query=$1
if [[ "$query" =~ ^[0-9]+$ ]]; then
  where="id = $query"
elif [[ "$query" == *:* ]]; then
  # match_key looks like "17:14:7" or "unmatched:filename.png"
  where="match_key = '${query//\'/\'\'}'"
else
  # source_files is a JSON array; LIKE picks up the filename as a substring
  where="source_files LIKE '%${query//\'/\'\'}%'"
fi

matches=$(sqlite3 "$DB" "SELECT id || ' ' || match_key || '  ' || source_files FROM match_results WHERE $where;")
if [[ -z "$matches" ]]; then
  echo "no match for: $query"
  exit 1
fi

echo "Will delete:"
printf '  %s\n' "$matches"
read -r -p "Confirm? [y/N] " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || {
  echo "aborted"
  exit 0
}

sqlite3 "$DB" "DELETE FROM match_results WHERE $where;"
echo "deleted."
