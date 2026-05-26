#!/usr/bin/env bash
# Dump every match as newline-delimited JSON to stdout. Each line is one
# match's worth of raw per-screenshot rows grouped by table — so the
# export captures the truth the aggregator works from, not the
# aggregator's output. Use jq to re-fold if you need a flat shape.
#
# Schema of each emitted line:
#   {
#     "match_key": "...",
#     "summary":     [ {...full row...}, ... ],
#     "scoreboard":  [ {...} ],
#     "personal":    [ {...}, ... ],
#     "rank":        [ {...} ],
#     "unknown":     [ {...} ]
#   }
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_db.sh
. "$SCRIPT_DIR/_db.sh"

DB=$(recall_db_path)
require_new_schema "$DB"

# `key_table_payload` CTE: one row per (match_key, table-name, full-row
# JSON). json_group_object groups by table-name to build the per-match
# object shape.
sqlite3 "$DB" <<'SQL'
.mode list
.separator ""
WITH parents AS (
  SELECT 'summary'    AS t, match_key, json_object(
    'id', id, 'filename', filename, 'parsed_at', parsed_at,
    'map', map, 'mode', mode, 'hero', hero,
    'result', result, 'final_score', final_score, 'date', date,
    'finished_at', finished_at, 'game_length', game_length,
    'perf_elim_total', perf_elim_total, 'perf_elim_avg_per_10min', perf_elim_avg_per_10min,
    'perf_assists_total', perf_assists_total, 'perf_assists_avg_per_10min', perf_assists_avg_per_10min,
    'perf_deaths_total', perf_deaths_total, 'perf_deaths_avg_per_10min', perf_deaths_avg_per_10min
  ) AS row FROM summary_screenshots
  UNION ALL SELECT 'scoreboard', match_key, json_object(
    'id', id, 'filename', filename, 'parsed_at', parsed_at,
    'map', map, 'mode', mode, 'hero', hero,
    'eliminations', eliminations, 'assists', assists, 'deaths', deaths,
    'damage', damage, 'healing', healing, 'mitigation', mitigation
  ) FROM scoreboard_screenshots
  UNION ALL SELECT 'personal', match_key, json_object(
    'id', id, 'filename', filename, 'parsed_at', parsed_at, 'hero', hero
  ) FROM personal_screenshots
  UNION ALL SELECT 'rank', match_key, json_object(
    'id', id, 'filename', filename, 'parsed_at', parsed_at,
    'rank', rank, 'level', level, 'rank_progress', rank_progress,
    'change_percent', change_percent, 'result', result
  ) FROM rank_screenshots
  UNION ALL SELECT 'unknown', match_key, json_object(
    'id', id, 'filename', filename, 'parsed_at', parsed_at
  ) FROM unknown_screenshots
),
grouped AS (
  SELECT match_key, t, json_group_array(json(row)) AS rows
  FROM parents GROUP BY match_key, t
)
SELECT json_object(
  'match_key', match_key,
  'summary',    COALESCE(MAX(CASE WHEN t='summary'    THEN json(rows) END), json('[]')),
  'scoreboard', COALESCE(MAX(CASE WHEN t='scoreboard' THEN json(rows) END), json('[]')),
  'personal',   COALESCE(MAX(CASE WHEN t='personal'   THEN json(rows) END), json('[]')),
  'rank',       COALESCE(MAX(CASE WHEN t='rank'       THEN json(rows) END), json('[]')),
  'unknown',    COALESCE(MAX(CASE WHEN t='unknown'    THEN json(rows) END), json('[]'))
)
FROM grouped
GROUP BY match_key
ORDER BY match_key;
SQL
