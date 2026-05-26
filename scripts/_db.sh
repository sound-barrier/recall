# shellcheck shell=bash
# Shared helpers for the db-*.sh scripts. Source from another script with:
#   . "$(dirname "$0")/_db.sh"
#
# Not executable on its own (leading underscore = "library, not a
# command"). Provides:
#
#   recall_db_path  → echoes the path the Recall app actually uses on this
#                     OS, honoring the RECALL_DB env override.
#   require_new_schema → exits 1 with a clear message if the DB still has
#                     the pre-PR-#45 `match_results` table (i.e. hasn't
#                     been wiped + recreated against the per-screenshot-
#                     type schema).
#   parent_tables   → space-separated list of the five parent tables.
#   child_tables    → space-separated list of the five child tables (in
#                     the order their CASCADE deletes should fire).

# recall_db_path resolves the platform-canonical DB location, mirroring
# pkg/app/settings.go::appDataDir. Override with RECALL_DB=<path> when
# inspecting a copy. Does NOT verify the file exists — callers can `[[ -f
# … ]]` if needed.
recall_db_path() {
  if [[ -n "${RECALL_DB:-}" ]]; then
    printf '%s\n' "$RECALL_DB"
    return
  fi
  case "$(uname -s)" in
    Darwin) printf '%s\n' "$HOME/Library/Application Support/Recall/db/recall.db" ;;
    Linux) printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/recall/db/recall.db" ;;
    MINGW* | MSYS* | CYGWIN*) printf '%s\n' "$APPDATA/Recall/db/recall.db" ;;
    *) printf '%s\n' "$HOME/.config/recall/db/recall.db" ;; # best-effort
  esac
}

parent_tables() {
  printf '%s\n' summary_screenshots scoreboard_screenshots personal_screenshots rank_screenshots unknown_screenshots
}

child_tables() {
  printf '%s\n' summary_heroes_played scoreboard_hero_stats personal_hero_stats rank_modifiers rank_sr
}

# require_new_schema exits 1 if the DB carries the pre-PR-#45 single-
# table layout. PR #45 was a no-migration cut-over — the maintainer's
# expectation is that existing DBs get wiped and the app re-creates the
# new schema on next launch. These scripts can't safely operate against
# the old shape (every query would fail with "no such table"), so we
# detect and bail with an actionable message instead.
require_new_schema() {
  local db=$1
  if ! [[ -f "$db" ]]; then
    echo "no DB at $db" >&2
    echo "→ launch the Recall app once so it can create the schema, or set RECALL_DB=<path>" >&2
    exit 1
  fi
  local found
  found=$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='table' AND name='match_results'" 2>/dev/null || true)
  if [[ -n "$found" ]]; then
    echo "DB at $db carries the pre-PR-#45 'match_results' schema." >&2
    echo "→ PR #45 was a no-migration cut-over. Wipe with:" >&2
    echo "    rm \"$db\"" >&2
    echo "  then relaunch the app; it'll create the 10-table 3NF schema." >&2
    exit 1
  fi
}
