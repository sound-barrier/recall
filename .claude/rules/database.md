---
paths:
  - "pkg/db/**"
---

# Database, schema & pipeline

## Pipeline

```text
screenshots/*.png
      │
      ▼  (Tesseract via parser.ParseScreenshot, dispatched per screenshot type)
parser.MatchResult
      │
      ▼  (pkg/app/parse.go: screenshotType + resolveMatchKey, then per-type Upsert)
SQLite per-type tables:
   summary_screenshots    + summary_heroes_played
   teams_screenshots + teams_hero_stats
   personal_screenshots   + personal_hero_stats
   rank_screenshots       + rank_modifiers + rank_sr
   unknown_screenshots                                  ← source of truth (1 row per screenshot)
      │
      │  (read time: pkg/app/aggregate.go::aggregateAll bulk-loads,
      │   groups by match_key, folds via mergeMatchResult)
      ▼
   MatchRecord
      │
      └──→ Wails GetMatchResults() / GET /api/v1/matches ──→ Vue UI
```

**SQLite is the source of truth.** Raw per-screenshot rows are preserved
verbatim — aggregation (folding multiple screenshots into one match) happens at
read time, so a wrong scalar from one screenshot can be corrected later by adding
another screenshot to the match. The aggregator's only consumers are the Wails
bindings and the HTTP API.

## Schema (3NF, 10 tables)

Five **parent** tables (one per screenshot type) plus five **child** tables for
repeating-group fields:

| Parent | Children |
|---|---|
| `summary_screenshots` (scalar SUMMARY fields + the player's E/A/D + 3 `perf_*_avg_per_10min` rates) | `summary_heroes_played` (hero, percent_played, play_time) |
| `teams_screenshots` (E/A/D + damage/healing/mit + map/mode/hero) | `teams_hero_stats` (hero, stat_key, stat_value) |
| `personal_screenshots` (hero only) | `personal_hero_stats` (hero, stat_key, stat_value) |
| `rank_screenshots` (rank/level/progress/change/result) | `rank_modifiers` (modifier), `rank_sr` (hero, sr, change) |
| `unknown_screenshots` (no domain fields) | *(none)* |

Each parent has `id INTEGER PK AUTOINCREMENT`, `filename TEXT UNIQUE`,
`match_key TEXT NOT NULL`, `parsed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
and `screenshots_dir_id INTEGER REFERENCES screenshots_dirs(id) ON DELETE RESTRICT`.
Children reference their parent with `ON DELETE CASCADE` and have a composite PK
preventing duplicate fold-ins on re-parse. **`NewSQLStore` must
`PRAGMA foreign_keys = ON`** — SQLite parses CASCADE rules but only enforces them
when this pragma is set on every connection.

**`screenshots_dir_id` is `RESTRICT`, not `SET NULL`.** A `screenshots_dirs` row
cannot be deleted while any screenshot row still references it — orphan rows
would render as broken thumbnails in the detail panel with no diagnostic.
Callers that want to remove a directory clean up dependent screenshot rows
first; the FK keeps the invariant from leaking into the on-disk schema.

## Naming conventions

- **SQL identifiers are snake_case.** Columns are `match_key`, `parsed_at`,
  `distance_seconds`, `overridden_at`; tables are `summary_screenshots`,
  `match_annotation_members`. Never abbreviate units — `distance_seconds`, not
  `distance_s`; `set_at` is too vague, prefer a verb prefix like `overridden_at`.
- **Timestamp columns end in `_at`.** Grep-friendly. Every table is `STRICT`,
  which forbids `DATETIME`, so every `*_at` column is `TEXT` holding an explicit
  RFC3339 UTC string, defaulted/stamped with
  `strftime('%Y-%m-%dT%H:%M:%SZ','now')` — never `CURRENT_TIMESTAMP` (its
  space-separated output isn't RFC3339, and the Go loaders scan these into
  plain `string`s expecting RFC3339). Sweep new columns onto the same
  convention.
- **OpenAPI path params mirror DB columns** — `{match_key}`, `{filename}`,
  `{profile}`. The Go side reads them via `r.PathValue("match_key")`; the
  JSON tag on the Go struct is `json:"match_key"`. There's no
  snake/camel boundary anywhere on the wire — only Go field names
  (`MatchKey`, `DistanceSeconds`) carry Go's exported-identifier convention.

**One fact, one home — E/A/D.** The player's eliminations/assists/deaths are
observed by TWO screenshots: the TEAMS scoreboard and the SUMMARY performance
panel. Both rows record what their own screenshot said (raw provenance is the
point), under the SAME column names, and the read-time fold reconciles them.
`parser.Performance` still ships `total` on the wire, but nothing stores it —
`aggregate.InferPerformanceTotals` fills it from the merged scalar at read time,
which is what makes an eliminations override move the performance panel with it.

**Derived fields are not stored.** `role` is computed from `hero` via
`parser.HeroRole`, `type` from `map` via `parser.MapType`; both lookups hit the
YAML-derived in-memory tables. Storing them would be a 3NF violation (transitive
dependency) and surface as "row A says juno=support but row B says juno=dps"
after a YAML change.

## Match time: naive-local axis + canonical UTC

OCR `date` (`YYYY-MM-DD`) and `finished_at` (`HH:MM`) are the OW scoreboard's
**naive local wall clock** — no timezone. The `match_key` timestamp (from the
filename) is on the **same naive-local axis**. These three stay naive-local and
are **never converted**: the correlator's `corroborated()`
(`pkg/correlate/correlation.go`) compares OCR `finished_at` `HH:MM` against the
filename `HH:MM`, and `RowsConflict`/dedup do string equality — all correct only
because the axes match. Re-encoding the key would also force a 19-table lockstep
rewrite (no `ON UPDATE CASCADE`).

`played_at_utc` (TEXT RFC3339, nullable) is an **additive canonical UTC instant**
alongside them, on `summary_screenshots` + `user_match_data`. It's derived at
parse time by `match.LocalWallClockToUTC(date, finished_at, time.Local)` —
interpreting the wall clock in the machine's timezone **identity** (a full zone,
so DST is correct for the match's own date: a January match is MST, a July match
MDT). Manual matches carry a wire offset so their UTC is exact. The frontend
renders `played_at_utc` in the **viewer's current timezone** (matching how
`parsed_at`/`*_at` — already real UTC — are shown), and seasons compare against
it directly. For a stationary user the rendered value equals the naive wall
clock; a viewer who changed timezones sees matches shift.

**Backfill:** existing rows get `played_at_utc` via **Re-parse All** (the parse
path recomputes it); a new parse populates it immediately. The additive column
needs no live migration (`pkg/db/migrate.go` is inert pre-1.0). Store canonical
UTC as `TEXT` (RFC3339), not `DATETIME`, so the `*string` round-trip skips the
driver's `time.Time` coercion.

## Write path (per screenshot, inside one `BEGIN…COMMIT`)

1. `screenshotType()` classifies the parse result and dispatches to one of
   `UpsertSummary` / `UpsertTeams` / `UpsertPersonal` / `UpsertRank` /
   `UpsertUnknown`.
2. **`resolveMatchKey()`** scans every parent table for an existing screenshot to
   adopt the key from:
   - **EAD-signature match** — any existing teams with the same non-zero
     `(eliminations, assists, deaths)` and no `(map, hero)` conflict. Bridges
     in-game teams ↔ post-match summary.
   - **Timestamp-window match** — any existing screenshot within `mergeWindow`
     (2 min) with no signature conflict. Closest-in-time wins.
   - **Fresh key** — `match:<earliest-filename-ts>`, or `unmatched:<filename>`
     for files without a parseable timestamp.
3. Parent UPSERT via `ON CONFLICT(filename) DO UPDATE SET … RETURNING id` —
   `parsed_at` is intentionally **not** in the SET clause so the first-insert
   timestamp survives re-parses. The INSERT side binds it through
   `suppliedInstantOrNow` (`COALESCE(NULLIF(?,''), strftime(…))`): a caller
   that supplies an instant gets it written as given, an empty one is stamped
   by the server. That is what lets a bundle restore bring back WHEN a match
   was parsed instead of claiming everything happened at import time. Same
   rule, same helper, for `user_match_data.updated_at`,
   `match_coach_notes.accepted_at`, and the `*At` restore variants
   `SetReviewAt` / `SetAnnotationAt` — whose plain siblings (`SetReview`,
   `SetAnnotation`) always stamp now, because a live edit's instant is the
   store's to assign. `dbtest.Fake` mirrors every one of these; the shared
   contract suite (`store_stamp_contract_test.go`) holds both to it.
4. `DELETE FROM <child> WHERE <parent>_id = ?` to wipe stale children, then
   `INSERT INTO <child> …` for every new child row.

DELETE-then-INSERT (instead of UPSERT) for children is deliberate: each child PK
is composite `(parent_id, hero[, stat_key])`, and a re-parse that drops a hero
must wipe that hero's old row — UPSERT alone wouldn't remove it. Idempotent:
re-clicking Parse replaces rows in place, no duplicates.

## Read path (`pkg/app/aggregate.go::aggregateAll`)

One bulk SELECT per parent + one per child table — every table hit exactly once
per call (called from `GetMatchResults`, so no N+1 risk). Child rows attach to parents by id, parents re-key by `match_key`, each
group sorts by `(filename-timestamp asc, parsed_at asc)`, and `mergeMatchResult`
folds via "first non-empty wins". `role` and `type` are resolved on the fly via
`parser.HeroRole` / `parser.MapType`, never stored.

## User override layer (edits + manual matches)

A second per-`match_key` layer lets the user **correct** a parsed match or
**hand-enter** one without OCR — kept entirely separate from the OCR rows so a
reset restores the original. Five tables in `schema.sql`:

- `user_match_data` (parent, `match_key` PK) — scalar override columns
  (`map`, `hero`, E/A/D, `damage`/`healing`/`mitigation`, `result`, `rank`,
  `level`, …), each NULL until set. **NULL = "not overridden, use OCR";
  non-NULL = the user's value**, so an explicit `0` is a real edit, not
  "unset". Scanned as `*string` / `*int` so nil ↔ SQL NULL round-trips.
- `user_match_heroes` (child) — the heroes-played LIST override (position 0 =
  primary); replaces the OCR roster wholesale when present.
- `user_match_hero_stats` (child) — per-`(hero, stat_key)` cell overrides,
  applied **independently** of the list so a stat edit never implies a roster
  swap.
- `user_match_sr` / `user_match_rank_modifiers` (children) — per-hero SR +
  rank modifiers (e.g. "demotion protection").

`queue_type` / `play_mode` are **not** duplicated here — manual entry reuses the
existing `match_queue` / `match_play_mode` aux tables, so the right-side
detail-panel choosers work unchanged on a manual `match_key`.

**Read path** (`pkg/aggregate`): `AttachUserData` overlays the override row onto
the folded OCR `Data` (non-NULL scalars win; heroes-list / stat-cell / SR
overlay) and **re-derives** `Role` / `GameMode` from any edited hero / map
(still never stored). It runs **after** `SynthesizeManualMatches`, which appends
an empty record for every `user_match_data` key with no screenshot row (a manual
match lives entirely in this layer). `MatchRecord.Source` is `ocr` /
`ocr_edited` / `manual`; `EditedFields` lists the overridden dotted paths driving
the ✎ revert markers.

Provenance is derived: a `user_match_data` row **plus** screenshot rows ⇒
`ocr_edited`; a row with **no** screenshot rows ⇒ `manual`; no row ⇒ `ocr`.
`HardDeleteMatch` and `Clear` wipe this layer too — essential for manual
matches, whose data lives ONLY here, so a stale row would resurrect the match on
the next aggregate. Store CRUD lives in `store_usermatch.go`
(`UpsertUserMatchData` / `LoadAllUserMatchData` / `DeleteUserMatchData` +
`MatchKeyExists` for the manual-create collision check); App methods
(`UpdateMatchData` / `ResetMatchData` / `CreateManualMatch`) in
`pkg/app/usermatch.go`.

## DB location + identity

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Recall/profiles/<active>/db/recall.db` |
| Linux | `~/.config/recall/profiles/<active>/db/recall.db` (or `$XDG_CONFIG_HOME/...`) |
| Windows | `%AppData%\Recall\profiles\<active>\db\recall.db` |

Resolved by `App.dataDir()` (returns `a.profiles.ActiveDir()`) in
`pkg/app/settings.go`. Install root (parent of `profiles/`) comes from
`appBaseDir()` honoring `RECALL_DATA_DIR`. Match identity is `match_key` (string)
— **no integer `id`** on the API surface. Per-source-file screenshot type is the
parent table the row lives in; `MatchRecord.SourceTypes` is built at aggregate
time from each row's parent table name.

## Replay codes are an identity, and the store enforces it

`match_annotations.replay_code` was a display string: nullable, unvalidated,
no index. It is now the token a coach and a player independently derive the
same `match_key` from (`replay-<CODE>`, see `pkg/match/replay_code.go`), so
the store holds it to that:

- **Canonical form** — six uppercase ASCII alphanumerics. Writes go through
  `matchedit.normalizeAnnotation`; `bundle.Import` deliberately does NOT
  reject, only normalizes, because failing a whole restore over one stale
  code would cost a user their history to enforce a format.
- **Unique** — a partial index (`WHERE replay_code IS NOT NULL AND <> ''`).
  Partial because most matches have no code, and SQLite lets NULLs coexist
  under a unique index but not empty strings.

Both are applied by `normalizeReplayCodes` in `pkg/db/schema_replay_code.go`,
run at store open beside `backfillLegacyNulls`. It is **not** in `schema.sql`,
and the ordering is the reason: a database written by an older build may hold
two matches claiming one code, and `CREATE UNIQUE INDEX` fails while that
stands — so the tie is broken first (earliest match keeps the code) and the
index built after. An index that fails at open is an app that will not start.

A legacy code of the wrong LENGTH is re-cased and otherwise left alone. It
still renders, still searches, and simply never mints a key — which is what
it already did. Deleting user data to satisfy a new rule is the worse trade.

## Adding a field

Pre-1.0 the schema lives entirely in `pkg/db/schema.sql`, applied verbatim on
every `NewSQLStore`. When the schema changes incompatibly the operator wipes
the dev DB and relaunches (CONTRIBUTING.md carries the per-platform path).
Statements are separated by a whole-line `-- statement-end` sentinel.

- **New parser scalar** → edit `pkg/db/schema.sql` to add the column to the
  matching `CREATE TABLE`, then add the field to the matching `*Row` struct
  in `pkg/db/store.go` and to the Upsert SET clause. Wipe + relaunch picks
  up the change.
- **New repeating-group dimension** → add a new `CREATE TABLE IF NOT EXISTS`
  block to `schema.sql` referencing the right parent with `ON DELETE CASCADE`.

The migration framework in `pkg/db/migrate.go` is scaffolded but inert until
1.0. `pkg/db/migrations/` ships with no `.up.sql` / `.down.sql` pairs, so
`applyMigrations` is a no-op on every store open. Once 1.0 lands and the
schema is stable, schema changes go in as versioned
`NNNN_<name>.{up,down}.sql` pairs under `pkg/db/migrations/` and the runner
picks them up automatically.

## sqlclosecheck

When a loop opens a fresh `s.db.Query(...)` on every iteration with multiple exit
paths, extract the per-iteration body into a helper so a single
`defer rows.Close()` covers every return — open-coding `_ = rows.Close()` at each
exit will be flagged. Pattern: `SQLStore.collectFilenames` in `pkg/db/store.go`.
