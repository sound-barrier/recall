-- 0006_hero_raw_map_raw.up.sql
--
-- Adds hero_raw / map_raw columns to every per-screenshot parent table
-- that already carries hero / map. The new columns preserve the raw
-- OCR'd hero-name or map-name string when the parser's canonical
-- matcher (extractHeroes / bestKnownMapInText) rejects the candidate
-- as "not in heroes.yaml / maps.yaml". Two downstream uses:
--
--   1. UI surfaces "Unknown hero (miyazaki?)" / "Unknown map (X?)"
--      chips by reading data.hero == '' AND data.hero_raw != ''
--      (same shape for map).
--   2. After a YAML release adds a new hero/map, App.Startup's boot
--      re-aggregate walks WHERE hero='' AND hero_raw != '' and
--      re-runs the matcher against the current roster, promoting
--      newly-recognised rows to canonical without a Tesseract re-run.
--
-- All columns are TEXT NOT NULL DEFAULT '' so the migration is
-- backwards-compatible (existing rows get '' on load) and the read
-- path doesn't have to handle NULLs.

ALTER TABLE summary_screenshots    ADD COLUMN hero_raw TEXT NOT NULL DEFAULT '';
-- statement-end
ALTER TABLE summary_screenshots    ADD COLUMN map_raw  TEXT NOT NULL DEFAULT '';
-- statement-end
ALTER TABLE scoreboard_screenshots ADD COLUMN hero_raw TEXT NOT NULL DEFAULT '';
-- statement-end
ALTER TABLE scoreboard_screenshots ADD COLUMN map_raw  TEXT NOT NULL DEFAULT '';
-- statement-end
ALTER TABLE personal_screenshots   ADD COLUMN hero_raw TEXT NOT NULL DEFAULT '';
-- statement-end
