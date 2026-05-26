#!/usr/bin/env bash
# Print the platform-canonical Recall DB path (or the RECALL_DB override
# if set). Useful for `sqlite3 "$(scripts/db-where.sh)"` shell sessions
# and "where is my data?" sanity checks.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_db.sh
. "$SCRIPT_DIR/_db.sh"

db=$(recall_db_path)
echo "$db"
if [[ -f "$db" ]]; then
  size=$(wc -c <"$db" | tr -d '[:space:]')
  echo "  exists, $size bytes" >&2
else
  echo "  not present yet — launch the Recall app once to create it" >&2
fi
