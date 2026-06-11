# shellcheck shell=bash
# Shared helpers for the db-*.sh scripts. Source from another script with:
#   . "$(dirname "$0")/_db.sh"
#
# Not executable on its own (leading underscore = "library, not a
# command"). Provides:
#
#   recall_base_dir       → echoes the install-wide base directory
#                           (parent of profiles/), honoring
#                           RECALL_DATA_DIR.
#   recall_active_profile → echoes the profile name the scripts should
#                           operate on. Resolves RECALL_PROFILE override,
#                           then <base>/profiles.json's active_profile,
#                           then falls back to "main".
#   recall_db_path        → echoes the SQLite path for the currently-
#                           active profile, honoring the RECALL_DB env
#                           override.
#   require_new_schema    → exits 1 with a clear message if the DB is
#                           missing or still carries the pre-PR-#45
#                           `match_results` table.
#   parent_tables         → space-separated list of the five parent tables.
#   child_tables          → space-separated list of the five child tables
#                           (in the order their CASCADE deletes should fire).

# recall_base_dir resolves the install-wide base directory — the parent
# of profiles/. Mirrors pkg/app/settings.go::appBaseDir. Resolution:
#   1. RECALL_DATA_DIR — full override (the repo's .envrc sets this to
#                        $PWD/data when direnv is active, so `wails dev`
#                        and the db-*.sh scripts share the in-repo dev
#                        data without further config).
#   2. Platform user-config dir — what the released app uses.
recall_base_dir() {
  if [[ -n "${RECALL_DATA_DIR:-}" ]]; then
    printf '%s\n' "$RECALL_DATA_DIR"
    return
  fi
  case "$(uname -s)" in
    Darwin) printf '%s\n' "$HOME/Library/Application Support/Recall" ;;
    Linux) printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/recall" ;;
    MINGW* | MSYS* | CYGWIN*) printf '%s\n' "$APPDATA/Recall" ;;
    *) printf '%s\n' "$HOME/.config/recall" ;; # best-effort
  esac
}

# recall_active_profile resolves which profile's DB the scripts should
# act on. Resolution order:
#   1. RECALL_PROFILE  — explicit override (mirrors the app's
#                        --profile=<name> CLI flag).
#   2. profiles.json   — reads active_profile from <base>/profiles.json
#                        if it exists.
#   3. "main"          — fresh-install default; works even before the
#                        app has been launched.
recall_active_profile() {
  if [[ -n "${RECALL_PROFILE:-}" ]]; then
    printf '%s\n' "$RECALL_PROFILE"
    return
  fi
  local meta
  meta="$(recall_base_dir)/profiles.json"
  if [[ -f "$meta" ]]; then
    # No jq dependency — pluck "active_profile":"…" with sed.
    local name
    name=$(sed -n 's/.*"active_profile"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$meta" | head -n1)
    if [[ -n "$name" ]]; then
      printf '%s\n' "$name"
      return
    fi
  fi
  printf '%s\n' main
}

# recall_db_path resolves the SQLite path, mirroring the layout that
# pkg/app/profile.go computes from <base>/profiles/<active>/db/.
# Resolution order:
#   1. RECALL_DB — full path to the .db file (most specific override).
#   2. <base>/profiles/<active>/db/recall.db
# Does NOT verify the file exists — callers can `[[ -f … ]]` if needed.
recall_db_path() {
  if [[ -n "${RECALL_DB:-}" ]]; then
    printf '%s\n' "$RECALL_DB"
    return
  fi
  printf '%s/profiles/%s/db/recall.db\n' "$(recall_base_dir)" "$(recall_active_profile)"
}

parent_tables() {
  printf '%s\n' summary_screenshots teams_screenshots personal_screenshots rank_screenshots unknown_screenshots
}

child_tables() {
  printf '%s\n' summary_heroes_played teams_hero_stats personal_hero_stats rank_modifiers rank_sr
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
    echo "→ launch the Recall app once so it can create the schema," >&2
    echo "  or set RECALL_DB=<path>, RECALL_PROFILE=<name>, or" >&2
    echo "  RECALL_DATA_DIR=<base> to point at an existing install." >&2
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
