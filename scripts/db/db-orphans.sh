#!/usr/bin/env bash
# List matches whose match_key appears in only one parent table — i.e.
# incomplete captures that would benefit from re-taking the missing
# screenshot types. The PR-#45 "fix later by adding screenshots" workflow
# starts here: re-capture the missing tab in-game, drop it in the
# screenshots dir, Parse — correlation re-folds it into the existing key.
#
# Columns: types_present (single-letter chip — S/T/P/R/U), match_key,
# files (the only screenshot(s) currently on file).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/_db.sh
. "$SCRIPT_DIR/../lib/_db.sh"

DB=$(recall_db_path)
require_new_schema "$DB"

sqlite3 -header -column "$DB" "
  WITH all_keys AS (
    SELECT match_key FROM summary_screenshots
    UNION SELECT match_key FROM teams_screenshots
    UNION SELECT match_key FROM personal_screenshots
    UNION SELECT match_key FROM rank_screenshots
    UNION SELECT match_key FROM unknown_screenshots
  ),
  presence AS (
    SELECT k.match_key,
      (SELECT 'S' FROM summary_screenshots    WHERE match_key=k.match_key LIMIT 1) AS s,
      (SELECT 'T' FROM teams_screenshots WHERE match_key=k.match_key LIMIT 1) AS t,
      (SELECT 'P' FROM personal_screenshots   WHERE match_key=k.match_key LIMIT 1) AS p,
      (SELECT 'R' FROM rank_screenshots       WHERE match_key=k.match_key LIMIT 1) AS r,
      (SELECT 'U' FROM unknown_screenshots    WHERE match_key=k.match_key LIMIT 1) AS u
    FROM all_keys k
  ),
  singletons AS (
    SELECT match_key, COALESCE(s,'') || COALESCE(t,'') || COALESCE(p,'') || COALESCE(r,'') || COALESCE(u,'') AS types
    FROM presence
    WHERE (CASE WHEN s IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN t IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN p IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN r IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN u IS NULL THEN 0 ELSE 1 END) = 1
  ),
  files_for_key AS (
    SELECT match_key, group_concat(filename, char(10) || '                                                                ') AS files FROM (
      SELECT match_key, filename FROM summary_screenshots
      UNION SELECT match_key, filename FROM teams_screenshots
      UNION SELECT match_key, filename FROM personal_screenshots
      UNION SELECT match_key, filename FROM rank_screenshots
      UNION SELECT match_key, filename FROM unknown_screenshots
    ) GROUP BY match_key
  )
  SELECT s.types AS type, s.match_key, f.files
  FROM singletons s
  LEFT JOIN files_for_key f USING (match_key)
  ORDER BY s.match_key;
"
