-- 0006_hero_raw_map_raw.down.sql — pairs with the up migration.
-- SQLite ≥ 3.35 supports DROP COLUMN directly; earlier versions
-- need the rebuild-table dance but the project pins modernc/sqlite
-- which embeds 3.4x.

ALTER TABLE summary_screenshots    DROP COLUMN hero_raw;
-- statement-end
ALTER TABLE summary_screenshots    DROP COLUMN map_raw;
-- statement-end
ALTER TABLE scoreboard_screenshots DROP COLUMN hero_raw;
-- statement-end
ALTER TABLE scoreboard_screenshots DROP COLUMN map_raw;
-- statement-end
ALTER TABLE personal_screenshots   DROP COLUMN hero_raw;
-- statement-end
