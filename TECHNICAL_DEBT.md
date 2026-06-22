# Technical debt

Delete a section when it's paid — git history is the audit trail, not a
strikethrough graveyard. No `~~item~~`, no `✅ DONE` subsections: when an item is
resolved, remove it. Section numbers are stable (gaps are fine; never renumber).
Keep each entry specific enough to act on without re-deriving the context.

## 4. Split oversized SFCs into sub-components + composables

Several SFCs exceed the 500-line soft cap carrying multiple concerns. Each split
is **behaviour-preserving**: a template section → child SFC, stateful `<script>`
logic → a `composables/<feature>/` composable, keeping every `data-*` test hook on
the same rendered node so the e2e specs need **no** edits. One commit per file;
verify each with `task test` + `task test-e2e` and confirm it renders identically.

**The shared-scoped-style gotcha (the reason this is per-file work, not a quick
extract):** sibling sections usually share scoped card chrome. A clean split must
move the genuinely-shared families to a co-located global CSS file (view-specific
classes, so global is safe) or a shared base component — do **not** flip
scoped→global blindly: it drops the `[data-v]` attribute, so first check no other
component uses the class (a global rule then leaks into it; a scoped `[data-v]`
override still wins by specificity, but a sibling using the *global* version
does not), then re-verify the dist theme-leak grep stays 0 and the a11y/axe e2e
are green. (This is why the byte-identical guarantee that made the app.css split
safe does NOT apply here.)

**Worked examples — `src/components/unknown/` + `src/components/matches/narrow/`
(both done):** unknown/ → `unknown.css` (shared card chrome global, `.field-label`
anchored to `.field-cell` to dodge the ExportBundleModal collision) + three section
children + a thin `UnknownMapsView` shell. narrow/ → `narrow.css` (the np-section /
np-chip + panel-content chrome global; `.np-btn` kept scoped so it can't leak into
NarrowPresets) + `NarrowChipFacet` (one parameterized component for all 12
multi-select facets, string or `{value,label}` options) + `NarrowTimeScope` /
`NarrowSinceAnchor` / `NarrowRefinement` / `NarrowLeaverHandling` section children,
plus a `NarrowPopover` coordinator (1283 → 573; the residual is the irreducible
popover machinery — focus trap, outside-click, `/` shortcut, `comboOpen`, bundle
wiring — so it's a cohesive-shell exemption, not a further split). Mirror these.

**Split (clear multi-concern seams):**

- `MatchMapRoleBand.vue` (**923** — grew ~280 lines since the count below was
  taken; re-promoted from "keep" to "split": at 923 it's the single largest SFC
  and no longer reads as one irreducible grid+heatmap), `ManualMatchModal.vue`
  (728), `MatchDetailPanel.vue` (685), `MatchJournal.vue` (626),
  `MatchesMembersList.vue` (662), `MatchesArchiveDrawer.vue` (591),
  `IgnoredFilesPanel.vue` (566), `MatchesDossierHead.vue` (584).

**Re-evaluate, expect to KEEP (irreducible markup/CSS or cohesive shell — the
file-size rule exempts these):** `MatchStatusChoosers.vue` (712, mostly
irreducible chooser markup + style), `MatchesView.vue` (693, the set-workspace
composition shell).

## 3. Consciously accepted — do NOT "fix" these without a new reason

Recorded so a future pass doesn't burn effort churning them (each was reviewed
and deliberately left):

- **`useMatchesDossierQueries.ts` (~696 lines) and `useMatchesNarrow.ts` (~539)**
  exceed the 500-line soft cap, but the bulk is a single cohesive dense function
  each — exactly what the file-size rule exempts. The narrow file's shared types +
  state factory were already split out (`matchesNarrow.types` / `.state`);
  fragmenting the remaining filter/query math would hurt cohesion for a number.
- **Report-only cyclomatic-complexity warnings** (`load()` 14, `valueLabel` 11):
  the complexity lefthook step is REPORT-ONLY for a reason — these are branchy by
  nature (an `allSettled` boot coordinator). Refactor only if a real
  readability/bug problem surfaces.
- **The remaining `as unknown as` casts** (`mountWidget` partial-dossier fixture +
  the `mount()` overload cast, the ECharts series union) are legitimate
  type-boundary casts. The one genuine type-lie (`enterEditMode` cast from
  KeyboardEvent to MouseEvent) was fixed.
- **External CI flakes** — the schemathesis random-seed failures on the PUT
  settings endpoints and the WebKit `match-detail-panel` timeout are
  non-deterministic and not fixable in code; re-run the job.

## 5. Activate the schema-migration path before 1.0 freezes the DB

`NewSQLStore` sets only `PRAGMA foreign_keys = ON` (`pkg/db/store.go:250`); there
is no `PRAGMA user_version`, and the migration runner is scaffolded-but-inert —
`pkg/db/migrate.go`'s `applyMigrations` is a no-op and `pkg/db/migrations/` ships
no `.up.sql`/`.down.sql` pairs. Today every incompatible schema change is
"wipe the dev DB and relaunch" (documented in `.claude/rules/database.md`).

That's the correct pre-1.0 stance, but it stops being acceptable the moment real
users have data: the **first** post-1.0 schema change needs a migration path that
doesn't exist yet. Pay this before the 1.0 tag, not after the first bug report:
set `user_version`, seed a baseline `0001_init` from the current `schema.sql`, and
flip `applyMigrations` live. The scaffold is already shaped for exactly this.

## 6. Schema-integrity gaps (two small, both ride the migration in #5)

- **`rank_modifiers.modifier` has no `CHECK` constraint** (`pkg/db/schema.sql`,
  the `rank_modifiers` block ~`:160`). Every sibling enum constrains its
  vocabulary at the DB — `leaver` (`:178`), `reviewed_by` (`:233`),
  `queue_type` (`:240`), `play_mode` (`:247`), `result` (`:290`). The modifier
  column is unconstrained `TEXT`, so a parser bug writing an unknown modifier
  persists silently. Add `CHECK (modifier IN (...))` with the OW2 vocabulary.
- **No GC path for `screenshots_dirs`.** `screenshots_dir_id` is
  `ON DELETE RESTRICT` (`schema.sql:53`, every parent table) — a deliberate,
  documented invariant (orphan rows would render as broken thumbnails). But
  nothing prunes a directory row once unreferenced, so changing the watched
  folder over time leaves dead rows that can never be removed. Decide:
  prune-on-unreferenced routine, `SET NULL` + nullable column, or
  "documented permanent." Low urgency (benign, slow-growing), but it's a
  product decision worth making before the schema freezes.

## 7. REST contract clarity for the public 1.0 surface

- **`PUT …/annotation` overloads delete into the upsert verb.**
  `handleSetMatchAnnotation` (`pkg/cmd/server_matches_item.go:122-194`) deletes
  the row and returns 204 when every field is empty. This is *deliberate and
  documented* (the 204 row in `.claude/rules/api-design.md`), with careful,
  well-tested null handling. But a third-party 1.0 consumer can't distinguish
  "clear everything" from "PUT with all fields blank" — they're the same call,
  and there is no explicit `DELETE …/annotation`. Either add the explicit
  `DELETE` (PUT becomes upsert-only) or document the overload prominently in the
  OpenAPI `description`. A decision to make while the verb set is still cheap to
  change.
- **Stale doc reference — non-existent migration.**
  `.claude/rules/api-design.md` (Transport gotchas) claims
  `db.NewSQLStore::migrateMatchKeysColonToDash` "rewrites legacy `match:` /
  `unmatched:` / `ambiguous:` rows on startup." No such function exists
  (`pkg/db/store.go:227-267` has no migration; a repo-wide search finds only the
  test string at `pkg/match/match_key_test.go:44`). The rule file is gitignored
  (dev-only), so it never ships, but it misleads anyone touching match-key code
  and falsely implies legacy colon-format DBs self-heal. Delete or correct the
  sentence; if legacy-key healing is actually wanted, build it (relevant to #5).

## 8. Unit coverage sits close to the floor

Live `task cover` (this review) — **frontend** branches **61.16%** against the
60% gate (~1.2 pts of headroom), lines 70.81%, functions 59.88% (ungated). One
removed covered branch can turn CI red. **Go** core packages are healthier
(`pkg/match` 100%, `pkg/correlate` 93.1%, `pkg/parser` 91.0%, `pkg/app` 76.1%,
`pkg/aggregate` 75.1%, `pkg/cmd` 74.4%, `pkg/db` 73.1%) — the thin Go spots are
`pkg/applog` (29.2%) and `pkg/probe` (57.8%). Thinnest frontend spots from the
live report: `stores/settings.ts` (0% branch / 32% stmt),
`match/match-table-tsv.ts` (27.58% branch),
`composables/shared/useProfileSwitcher.ts` (46.87% branch),
`match/pivot-fields.ts` (61.11% branch). Lift the consequential ones (the
settings store and the TSV-copy path first) so the margin isn't one commit deep.

## 9. First-run & recovery UX rough edges (cold-audience launch)

Shipping to a cold Reddit audience makes first-run clarity disproportionately
valuable:

- **Two independent first-run blockers, no unified checklist.** A new user must
  satisfy both a screenshots folder AND a located Tesseract before parsing.
  `IngestView.vue` surfaces them separately — the `!tesseractReady` heading
  (`:49`), the "set a screenshots folder" prompt (`:56`), the disabled
  Watch/Parse controls (`:89-128`) — so a first-timer fixes one, returns, and
  discovers the second. A single readiness checklist (folder ✓/✗ + Tesseract
  ✓/✗) would front-load both.
- **Hiding a match has no inline undo.** Hide moves it to the archive drawer
  (`MatchesArchiveDrawer.vue`); recovery is only via that drawer, which is easy
  to miss. An "Undo" toast on hide closes the loop.
- **Undiscoverable power feature + a magic number (polish).** `MatchesTable`
  supports drag cell-range select + `Ctrl/Cmd+C` TSV copy
  (`match/match-table-tsv.ts`) with no hint; and `SCROLL_STEP_PX = 80`
  (`MatchDetailPanel.vue:81`) is a commented magic number that drifts if row
  height changes — derive it from a row's measured height.

## 10. Minor doc nit — `ClearMatches` suppress-list semantics

`Clear()` unconditionally wipes `all_heroes_screenshots`
(`pkg/db/store_bulk.go:133`); `ClearDatabase(keepIgnored)` only snapshots and
restores `ignored_screenshots` (`pkg/app/match_record.go:93-110`). So a factory
reset with `keep_ignored=true` still drops the "All Heroes" skip-list. This is
**benign** (those screenshots are re-recognized and re-skipped next parse — no
data loss) and clearly commented in code, but the `ClearMatches` OpenAPI entry
doesn't mention it. One-line doc clarification.
