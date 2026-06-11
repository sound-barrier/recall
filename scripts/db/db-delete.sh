#!/usr/bin/env bash
# Delete one match (every contributing screenshot row across all 5 parent
# tables; children CASCADE). Lookup keys:
#   db-delete.sh match:2026-05-10T21:29:28   # exact match_key
#   db-delete.sh 22.36.31.03                 # filename substring
# Prompts before deleting; pass -y to skip the prompt for scripted use.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/_db.sh
. "$SCRIPT_DIR/../lib/_db.sh"

YES=false
if [[ "${1:-}" == "-y" ]]; then
  YES=true
  shift
fi
if [[ $# -lt 1 ]]; then
  echo "usage: $0 [-y] <match-key|filename-substring>" >&2
  exit 2
fi

DB=$(recall_db_path)
require_new_schema "$DB"

query=$1
esc=${query//\'/\'\'}

if [[ "$query" == *:* ]]; then
  where_keys="match_key='$esc'"
else
  where_keys="filename LIKE '%$esc%'"
fi

keys=$(sqlite3 "$DB" "
  SELECT match_key FROM summary_screenshots    WHERE $where_keys
  UNION SELECT match_key FROM teams_screenshots WHERE $where_keys
  UNION SELECT match_key FROM personal_screenshots   WHERE $where_keys
  UNION SELECT match_key FROM rank_screenshots       WHERE $where_keys
  UNION SELECT match_key FROM unknown_screenshots    WHERE $where_keys")
if [[ -z "$keys" ]]; then
  echo "no match for: $query" >&2
  exit 1
fi

# Per-key preview of what would be deleted.
echo "Will delete:"
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  esc_key=${key//\'/\'\'}
  files=$(sqlite3 "$DB" "
    SELECT filename FROM summary_screenshots    WHERE match_key='$esc_key'
    UNION SELECT filename FROM teams_screenshots WHERE match_key='$esc_key'
    UNION SELECT filename FROM personal_screenshots   WHERE match_key='$esc_key'
    UNION SELECT filename FROM rank_screenshots       WHERE match_key='$esc_key'
    UNION SELECT filename FROM unknown_screenshots    WHERE match_key='$esc_key'")
  echo "  $key"
  while IFS= read -r f; do [[ -n "$f" ]] && echo "    $f"; done <<<"$files"
done <<<"$keys"

if ! $YES; then
  read -r -p "Confirm? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || {
    echo "aborted"
    exit 0
  }
fi

# Single transaction so a row in table N can't be left dangling if a later
# table errors. PRAGMA foreign_keys=ON ensures children cascade.
sql="PRAGMA foreign_keys=ON; BEGIN;"
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  esc_key=${key//\'/\'\'}
  for t in $(parent_tables); do
    sql+=" DELETE FROM $t WHERE match_key='$esc_key';"
  done
done <<<"$keys"
sql+=" COMMIT;"

sqlite3 "$DB" "$sql"
echo "deleted."
