#!/usr/bin/env bash
# Per-table row counts + a histogram of match-coverage (how many distinct
# screenshot types each match has). Quick health snapshot for a dev DB.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_db.sh
. "$SCRIPT_DIR/_db.sh"

DB=$(recall_db_path)
require_new_schema "$DB"

echo "Parent tables:"
sqlite3 -header -column "$DB" "
  SELECT 'summary_screenshots'    AS tbl, COUNT(*) AS rows FROM summary_screenshots    UNION ALL
  SELECT 'teams_screenshots',          COUNT(*)        FROM teams_screenshots UNION ALL
  SELECT 'personal_screenshots',            COUNT(*)        FROM personal_screenshots   UNION ALL
  SELECT 'rank_screenshots',                COUNT(*)        FROM rank_screenshots       UNION ALL
  SELECT 'unknown_screenshots',             COUNT(*)        FROM unknown_screenshots;
"

echo
echo "Child tables:"
sqlite3 -header -column "$DB" "
  SELECT 'summary_heroes_played' AS tbl, COUNT(*) AS rows FROM summary_heroes_played UNION ALL
  SELECT 'teams_hero_stats',         COUNT(*)       FROM teams_hero_stats  UNION ALL
  SELECT 'personal_hero_stats',           COUNT(*)       FROM personal_hero_stats    UNION ALL
  SELECT 'rank_modifiers',                COUNT(*)       FROM rank_modifiers         UNION ALL
  SELECT 'rank_sr',                       COUNT(*)       FROM rank_sr;
"

echo
echo "Coverage histogram (matches grouped by # of contributing screenshot types):"
sqlite3 -header -column "$DB" "
  WITH all_keys AS (
    SELECT match_key FROM summary_screenshots
    UNION SELECT match_key FROM teams_screenshots
    UNION SELECT match_key FROM personal_screenshots
    UNION SELECT match_key FROM rank_screenshots
    UNION SELECT match_key FROM unknown_screenshots
  ),
  per_match AS (
    SELECT k.match_key,
      (CASE WHEN EXISTS(SELECT 1 FROM summary_screenshots    t WHERE t.match_key=k.match_key) THEN 1 ELSE 0 END) +
      (CASE WHEN EXISTS(SELECT 1 FROM teams_screenshots t WHERE t.match_key=k.match_key) THEN 1 ELSE 0 END) +
      (CASE WHEN EXISTS(SELECT 1 FROM personal_screenshots   t WHERE t.match_key=k.match_key) THEN 1 ELSE 0 END) +
      (CASE WHEN EXISTS(SELECT 1 FROM rank_screenshots       t WHERE t.match_key=k.match_key) THEN 1 ELSE 0 END) +
      (CASE WHEN EXISTS(SELECT 1 FROM unknown_screenshots    t WHERE t.match_key=k.match_key) THEN 1 ELSE 0 END)
      AS types_present
    FROM all_keys k
  )
  SELECT types_present AS types, COUNT(*) AS matches
  FROM per_match GROUP BY types_present ORDER BY types_present;
"

echo
total_keys=$(sqlite3 "$DB" "
  SELECT COUNT(DISTINCT match_key) FROM (
    SELECT match_key FROM summary_screenshots
    UNION SELECT match_key FROM teams_screenshots
    UNION SELECT match_key FROM personal_screenshots
    UNION SELECT match_key FROM rank_screenshots
    UNION SELECT match_key FROM unknown_screenshots)")
echo "Distinct matches: $total_keys"
