-- Reverse of 0001_init.up.sql. Drops children before parents so
-- ON DELETE CASCADE rules don't matter — the table objects vanish.
DROP TABLE IF EXISTS ambiguous_candidates;
-- statement-end
DROP TABLE IF EXISTS unknown_screenshots;
-- statement-end
DROP TABLE IF EXISTS hidden_matches;
-- statement-end
DROP TABLE IF EXISTS match_annotation_tags;
-- statement-end
DROP TABLE IF EXISTS match_annotation_members;
-- statement-end
DROP TABLE IF EXISTS match_annotations;
-- statement-end
DROP TABLE IF EXISTS rank_sr;
-- statement-end
DROP TABLE IF EXISTS rank_modifiers;
-- statement-end
DROP TABLE IF EXISTS rank_screenshots;
-- statement-end
DROP TABLE IF EXISTS personal_hero_stats;
-- statement-end
DROP TABLE IF EXISTS personal_screenshots;
-- statement-end
DROP TABLE IF EXISTS scoreboard_hero_stats;
-- statement-end
DROP TABLE IF EXISTS scoreboard_screenshots;
-- statement-end
DROP TABLE IF EXISTS summary_heroes_played;
-- statement-end
DROP TABLE IF EXISTS summary_screenshots;
-- statement-end
DROP TABLE IF EXISTS screenshots_dirs;
-- statement-end
