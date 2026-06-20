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

**Worked example — `src/components/unknown/` (done):** `unknown.css` holds the
shared card chrome (moved global, `.field-label` anchored to `.field-cell` to
dodge the ExportBundleModal collision); `UnknownCandidatePicker` /
`UnknownReferenceGapSection` / `UnknownUnmatchedSection` are the section children
(the last takes the shared `cardState` as a prop); `UnknownMapsView` is the thin
shell. Mirror this for the rest.

**Split (clear multi-concern seams):**

- `NarrowPopover.vue` (1283) → one child per `<section class="np-section">` group
  (or a parameterized facet component for the repetitive chip-pickers). **Heads-up:**
  `.np-btn` is defined scoped here but *used* in `NarrowPresets.vue` too, so moving
  the `.np-*` chrome global is behaviour-changing for NarrowPresets — verify its
  buttons render identically (or anchor/keep that rule). The `.lp-fade` /
  `.lp-slide` transitions + `.left-panel*` container are NarrowPopover-only (safe).
- `ManualMatchModal.vue` (728), `MatchDetailPanel.vue` (685), `MatchJournal.vue`
  (626), `MatchesMembersList.vue` (634), `MatchesArchiveDrawer.vue` (591),
  `IgnoredFilesPanel.vue` (566), `MatchesDossierHead.vue` (584).

**Re-evaluate, expect to KEEP (irreducible markup/CSS or cohesive shell — the
file-size rule exempts these):** `MatchMapRoleBand.vue` (647, dense grid + heatmap
CSS), `MatchStatusChoosers.vue` (712, mostly irreducible chooser markup + style),
`MatchesView.vue` (687, the set-workspace composition shell).

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
