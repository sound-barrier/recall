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
The PR `refactor/split-oversized-sfcs` carries four more (MatchesDossierHead →
`useDashboardGrid`; MatchesArchiveDrawer → `ArchiveBulkBar`; MatchDetailPanel →
`useDetailPanelKeyboard` + `DetailPanelHeader`; IgnoredFilesPanel → `IgnoredFileRow`).

**Still to split (clear multi-concern seams):**

- `MatchMapRoleBand.vue` (**923** — the single largest SFC; the roving-focus
  selection engine reaches into the grid DOM, so the split is the most delicate),
  `ManualMatchModal.vue` (728 — the form body is interwoven with the combobox
  wiring), `MatchesMembersList.vue` (662 — entangled windowing + virtualization +
  IntersectionObserver, lifecycle-bound).

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
- **`MatchJournal.vue` (626)** — re-promoted from #4 to KEEP. The Note / Replay /
  Group / Tags cells share `.journal-cell` chrome + the `saved`-pulse `@keyframes`,
  and its script is already a thin call into `useMatchAnnotationEditor`. A cell
  can't be pulled into a child without that shared chrome: promoting it to a global
  `app.css` file (the worked-example pattern) would blow the initial-CSS budget
  (~270 B headroom, and the journal CSS currently rides a lazy chunk), so a child
  SFC would have to *duplicate* ~80 lines of chrome — net worse than the
  oversized-but-cohesive single file. Cohesive-shell exemption.
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
