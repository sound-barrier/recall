# Technical debt

Delete a section when it's paid — git history is the audit trail, not a
strikethrough graveyard. No `~~item~~`, no `✅ DONE` subsections: when an item is
resolved, remove it. Section numbers are stable (gaps are fine; never renumber).
Keep each entry specific enough to act on without re-deriving the context.

## 3. Consciously accepted — do NOT "fix" these without a new reason

Recorded so a future pass doesn't burn effort churning them (each was reviewed
and deliberately left):

- **`useMatchesDossierQueries.ts` (~696 lines) and `useMatchesNarrow.ts` (~539)**
  exceed the 500-line soft cap, but the bulk is a single cohesive dense function
  each — exactly what the file-size rule exempts. The narrow file's shared types +
  state factory were already split out (`matchesNarrow.types` / `.state`);
  fragmenting the remaining filter/query math would hurt cohesion for a number.
- **`MatchJournal.vue` (626)** — re-promoted from #4 to KEEP. The Note / Replay /
  Group / Tags cells share `.journal-cell` chrome + the `saved`-pulse `@keyframes`,
  and its script is already a thin call into `useMatchAnnotationEditor`. A cell
  can't be pulled into a child without that shared chrome: promoting it to a global
  `app.css` file (the worked-example pattern) would blow the initial-CSS budget
  (~270 B headroom, and the journal CSS currently rides a lazy chunk), so a child
  SFC would have to *duplicate* ~80 lines of chrome — net worse than the
  oversized-but-cohesive single file. Cohesive-shell exemption.
- **Three oversized-but-cohesive Matches SFCs — `MatchMapRoleBand.vue` (923),
  `MatchStatusChoosers.vue` (712), `MatchesView.vue` (693).** `MatchMapRoleBand`
  (the single largest SFC) already has its logic maximally extracted — the
  selection state machine in `useMapRoleSelection`, the display filter in
  `useMapRoleConfig`, the time window in `useWindowMonths`, the data in the dossier
  composables — so its residual is the selection wiring *coupled to the grid DOM*
  (the `gridRef.querySelector('[data-mr-cell=…]')` roving-focus mirror +
  `elementFromPoint` drag hit-testing) plus ~410 lines of heatmap-grid CSS that
  can't move to a global file (the same lazy-chunk / initial-CSS-budget constraint
  as MatchJournal). `MatchStatusChoosers` is mostly irreducible chooser markup +
  style; `MatchesView` is the set-workspace composition shell. All three are
  cohesive-shell exemptions — the clean seams were already taken.
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
