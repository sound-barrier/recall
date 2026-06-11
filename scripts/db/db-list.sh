#!/usr/bin/env bash
# List every match with a coverage chip showing which screenshot types
# contributed (S=summary, T=teams, P=personal, R=rank, U=unknown).
# Aggregates across the 5 parent tables by match_key, prefers SUMMARY
# fields for display (since SUMMARY is the only type that carries
# map/date/result/score reliably).
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
  summaries AS (
    SELECT match_key, MIN(map) AS map, MIN(playlist) AS playlist, MIN(hero) AS hero,
           MIN(result) AS result, MIN(final_score) AS final_score, MIN(date) AS date
    FROM summary_screenshots GROUP BY match_key
  ),
  teams AS (
    SELECT match_key, MAX(eliminations) AS e, MAX(assists) AS a, MAX(deaths) AS d,
           MAX(damage) AS dmg, MAX(healing) AS hl, MAX(mitigation) AS mit,
           MIN(hero) AS hero
    FROM teams_screenshots GROUP BY match_key
  ),
  coverage AS (
    SELECT k.match_key,
      CASE WHEN EXISTS(SELECT 1 FROM summary_screenshots    t WHERE t.match_key=k.match_key) THEN 'S' ELSE '-' END ||
      CASE WHEN EXISTS(SELECT 1 FROM teams_screenshots t WHERE t.match_key=k.match_key) THEN 'T' ELSE '-' END ||
      CASE WHEN EXISTS(SELECT 1 FROM personal_screenshots   t WHERE t.match_key=k.match_key) THEN 'P' ELSE '-' END ||
      CASE WHEN EXISTS(SELECT 1 FROM rank_screenshots       t WHERE t.match_key=k.match_key) THEN 'R' ELSE '-' END ||
      CASE WHEN EXISTS(SELECT 1 FROM unknown_screenshots    t WHERE t.match_key=k.match_key) THEN 'U' ELSE '-' END
      AS types
    FROM all_keys k
  )
  SELECT
    k.match_key,
    c.types                                                                      AS types,
    COALESCE(s.map, '')                                                          AS map,
    COALESCE(s.playlist, '')                                                         AS playlist,
    COALESCE(s.hero, b.hero, '')                                                 AS hero,
    COALESCE(b.e, 0)   || '/' || COALESCE(b.a, 0)  || '/' || COALESCE(b.d, 0)    AS ead,
    COALESCE(b.dmg, 0) || '/' || COALESCE(b.hl, 0) || '/' || COALESCE(b.mit, 0)  AS dhm,
    COALESCE(s.result, '')                                                       AS result,
    COALESCE(s.final_score, '')                                                  AS score,
    COALESCE(s.date, '')                                                         AS date
  FROM all_keys k
  LEFT JOIN summaries   s ON s.match_key = k.match_key
  LEFT JOIN teams b ON b.match_key = k.match_key
  LEFT JOIN coverage    c ON c.match_key = k.match_key
  ORDER BY COALESCE(s.date, k.match_key);
"
