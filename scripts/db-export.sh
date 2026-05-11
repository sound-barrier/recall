#!/usr/bin/env bash
# Dump every record as newline-delimited JSON to stdout.
# Each line is a full match object: id, match_key, source_files, and every
# stat/metadata column rebuilt into a single JSON document.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$SCRIPT_DIR/../data/db/owmetrics.db"

sqlite3 "$DB" "
  SELECT json_object(
    'id',           id,
    'match_key',    match_key,
    'source_files', json(source_files),
    'map',          map,
    'type',         type,
    'mode',         mode,
    'role',         role,
    'hero',         hero,
    'eliminations', eliminations,
    'assists',      assists,
    'deaths',       deaths,
    'damage',       damage,
    'healing',      healing,
    'mitigation',   mitigation,
    'result',       result,
    'final_score',  final_score,
    'date',         date,
    'finished_at',  finished_at,
    'game_length',  game_length,
    'heroes_played', CASE WHEN heroes_played IS NULL THEN NULL ELSE json(heroes_played) END,
    'performance',   CASE WHEN performance   IS NULL THEN NULL ELSE json(performance)   END,
    'parsed_at',    parsed_at
  )
  FROM match_results
  ORDER BY id;
"
