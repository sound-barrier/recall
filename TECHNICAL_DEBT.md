# Technical debt

The single ledger for Recall's outstanding work — what's owed today, what's
deliberately accepted, and what's explicitly out of scope. Consolidates the former
`RECOMMENDATIONS.md` (the 1.0 action plan) and `REVIEW.md` (the CLAUDE.md-principle
audit); their shipped items were dropped on the way in.

**Delete a section when it's paid** — git history is the audit trail, not a
strikethrough graveyard. No `~~item~~`, no `✅ DONE` subsections. Section numbers
are stable (gaps are fine; never renumber). Keep each entry specific enough to act
on without re-deriving the context. Effort: S ≈ hours, M ≈ a day, L ≈ multi-day.

## Status — 1.0 readiness

Recall is 1.0-ready on correctness: thin-shell Vue + Pinia, file-per-concern
pure-Go (no-CGo) SQLite, disciplined REST/DB contracts, broad CI (dual build-tag
lint, schemathesis, CodeQL, gosec, govulncheck, SLSA build provenance,
Playwright + axe). The pre-1.0 contract-fix + polish pass is **done** — the
annotation `DELETE` verb, the `rank_modifiers` `CHECK`, the `screenshots_dirs` GC,
the first-run readiness checklist + hide-undo toast, the `ClearMatches` doc note,
the oversized-SFC splits, the stale-doc + cyclomatic-complexity + discoverability
polish all landed.

The 2026-07-02 full audit (49 verified findings; report archived at
`tmp/audit-2026-07-02.md`, regenerable from the audit PR) confirmed that
picture, and its Phase-0 quick-win sweep landed 17 fixes across db/app/
frontend/CI. What remains: **activate the migration framework before the tag
(section 5 — the deliberate *last* 1.0 commit)** — every other
catalogued section has been paid (the decomposition round carved
`pkg/bundle`, `pkg/gamedata`, and `pkg/profiles` out of the shell). Sections 6-7 were paid by the
Phase-2 PR (v2 export bundles, the golden-corpus lane, the Store contract
suite); section 8 by the Phase-3 PR (the narrow clause registry killed
the enumeration-spread bug class and its McCabe cluster, the dossier
bands share one header, each store owns its boot loader, api.ts uses the
generated wire types) along with §9's parse-loop cost (one correlation
snapshot per run); the rest of §9 (SSE terminal delivery) and most of §10
by the Phase-4 PR (store error context, pagination terminator, WAL,
profile-scoped localStorage, the pre-push hook isolation, panic recovery +
on-disk log + the Vue error boundary + the DB health surface, and the
oversized-SFC adjudications). The pre-tag coverage lift
landed on the genuinely consequential gap (the read-path sidecar/override
attach in `pkg/aggregate`, 75% → ~90%); the one infra package that stays
thin (`pkg/probe`) does so structurally, not for want of a test (see §3). Everything else
below is a catalogued section, deliberately accepted (§3), or out of scope.

## 3. Consciously accepted — do NOT "fix" these without a new reason

Reviewed and deliberately left, so a future pass doesn't burn effort churning
them. Last re-evaluated **2026-07-06** — every bullet verified against source;
changed bullets carry an inline re-evaluation note:

- **`useMatchesDossierQueries.ts` (~748 lines)** exceeds the 500-line soft cap,
  but it is one cohesive composable — a single `useDossierQueries` factory (the
  file's only export) whose bulk is 17 tightly-coupled query helpers
  (`topByCount`, `winrateBy`, `lossQualityBreakdown`, the time-of-day /
  day-of-week bucketers, …) returned as one bundle, each opening its own
  `computed()` over the same narrowed record set — the dense-single-concern case
  the file-size rule exempts; its shared types already live in
  `useMatchesDossier.types`. It grew from ~696 across 2026-07-03/04 by adding
  more dossier/trends widgets to the same tier, not a second concern creeping
  in, so splitting the query math would fragment one aggregation layer for a
  number. (Re-evaluated 2026-07-06: `useMatchesNarrow.ts` dropped from this
  bullet — the clause-registry split into `matchesNarrow.clauses.ts`, the exact
  fragmentation this bullet once argued against, shipped 2026-07-02 and left
  that file at 363 lines, under the cap.)
- **`MatchJournal.vue` (632).** The Note / Replay / Group / Tags cells share
  `.journal-cell` chrome + the `saved`-pulse `@keyframes`, and its script is
  already a thin call into `useMatchAnnotationEditor`. A cell can't be pulled into
  a child without that shared chrome: the journal CSS rides the lazy
  `MatchDetailPanel` chunk, so promoting it to a global `app.css` file (the
  worked-example pattern) would move ~80 lines of chrome into the eager,
  tightly-budgeted initial CSS (the cap lives in `scripts/ci/check-bundle-size.sh`
  — headroom is on the order of a KB, well short of the chrome block), so a
  child SFC would have to *duplicate* ~80 lines of chrome — net worse.
  Cohesive-shell exemption. (Re-evaluated 2026-07-06: count 626→632; the stale
  hardcoded headroom figure now defers to `check-bundle-size.sh` as the source
  of truth.)
- **`AboutModal.vue` (~675) and `MatchLeafRow.vue` (~637)** — adjudicated
  2026-07 (the last of the never-adjudicated four). (Re-evaluated 2026-07-06:
  the in-app self-update work had grown AboutModal to 778 with a CTA block
  rendering only in Section 1 — outside the "chrome shared verbatim across
  both update sections" rationale — so that block was extracted to
  `SelfUpdateCta.vue` the same day, restoring the exemption.) AboutModal's
  logic stays extracted (`useGameDataUpdate`, `useModalFocusTrap`, the
  `UpdateDiffManifest` + `SelfUpdateCta` children; the self-update state
  machine lives in the app store); its residual bulk is the
  `update-check-modal-*` chrome genuinely shared across both update sections,
  with the shared btn chrome reaching `SelfUpdateCta` via `:deep()` so nothing
  is duplicated. MatchLeafRow is ~370 lines of
  irreducible per-row grid CSS + dense 7-cell markup with all logic in
  `match-helpers`/`match-label-helpers`/`search-query`; its map/hero-block
  seams share the `.leaf-filter-cell` funnel chrome and would each thread
  6-7 props — the MatchJournal "net worse" precedent. `MatchHeroModeBand`
  needed no ruling: the Phase-3 `BandHeaderControls` extraction already put
  it at ~490. `MatchesTable` was the one with a real seam left — its
  ~100-line cell drag-select pointer machine moved to `useCellDragSelect`
  (script now ~155 lines; the ~570-line residual is table chrome under this
  same exemption).
- **Three oversized-but-cohesive Matches SFCs — `MatchMapRoleBand.vue` (768),
  `MatchStatusChoosers.vue` (712), `MatchesView.vue` (693).** `MatchMapRoleBand`
  (the single largest SFC) already has its logic maximally extracted — the
  selection state machine in `useMapRoleSelection`, the display filter in
  `useMapRoleConfig`, the time window in `useWindowMonths`, the data in the
  dossier composables, and the shared header furniture in `BandHeaderControls`
  — so its residual is the selection wiring *coupled to the grid DOM*
  (the `gridRef.querySelector('[data-mr-cell=…]')` roving-focus mirror +
  `elementFromPoint` drag hit-testing) plus ~280 lines of heatmap-grid CSS that
  can't move to a global file (the same lazy-chunk / initial-CSS-budget constraint
  as MatchJournal). `MatchStatusChoosers` is mostly irreducible chooser markup +
  style; `MatchesView` is the set-workspace composition shell. Cohesive-shell
  exemptions — the clean seams were already taken. (The other six oversized SFCs
  *were* split: MatchesDossierHead, MatchesArchiveDrawer, MatchDetailPanel,
  IgnoredFilesPanel, MatchesMembersList, ManualMatchModal. Re-evaluated
  2026-07-06: 923→768 — the `BandHeaderControls` extraction took the header
  seam after the original ruling; style block ~410→~280.)
- **App.vue is a clean 177-line thin shell** (zero business logic — it reads a
  few store refs, wires the App-shell composables, and renders chrome + one
  view; the parse-run-state / profile / tour / first-run wiring lives in the
  `composables/app/` seam, not the SFC). Extracting further is opportunistic
  Boy-Scout work, not owed. The thin-shell target is already met.
  (Re-evaluated 2026-07-06: 168→177.)
- **In-app self-update is Windows-only, one accepted cosmetic gap.** Recall
  ships a Windows desktop app only, so the Wails v3 `pkg/updater` flow (About
  dialog → Install → SHA256SUMS-verified swap → Restart) runs on Windows and is
  gated off everywhere else — non-Windows builds (macOS is a dev-only target),
  dev builds, and legacy machine-scope Program Files installs that aren't
  user-writable all surface the "Open release page" fallback
  (`can_self_update:false`). The one accepted quirk: the **Windows HKCU
  `DisplayVersion` goes stale** after an in-app update (the installer writes it,
  the updater doesn't) until the next installer run — cosmetic, only visible in
  Add/Remove Programs.
- **Report-only cyclomatic-complexity** — the sweep
  (`scripts/ci/check-complexity.sh`: gocyclo over Go + ESLint's `complexity`
  rule over `frontend/src`, threshold 10) stays REPORT-ONLY by design.
  Re-swept 2026-07-06: frontend max is still **50** (`compareCol` in
  `useTableSort.ts` — a flat 13-case column-comparator switch whose `??`
  fallbacks inflate the metric; accepted as a dispatch table). The old
  `useMatchesNarrow.ts` cluster (`passesNarrow` / `clauseLabel` /
  `activeClauses` / `clearClause`, once 43/33/25/21) is now all ≤10 and
  unflagged — the clause-registry refactor shipped
  (`matchesNarrow.clauses.ts`'s `NARROW_CLAUSES` drives all four off one
  registry), dissolving the parallel-list enumeration spread; that debt is
  paid and its old section-8 pointer is gone with it. The remaining frontend
  flags are dispatch/lambda/keydown churn (`onKeydown` in
  `useDetailPanelKeyboard.ts` 30, dossier-query reducers in
  `useMatchesDossierQueries.ts` up to 30, the `cellText` formatter switch in
  `match-table-tsv.ts` 28) — noise, not signal. Go-side max (non-test):
  `HardDeleteMatch` 25 (the `dbtest` fake), then `importUserLayer` 24,
  `writeFixture` 23, `loadBundleUserLayer` 22; `parsePersonalStatCell` holds
  at 17. Everything else: refactor only if a real readability/bug problem
  surfaces.
- **DRY hotspots to *watch*, not pre-abstract** — the nine `register*Routes` in
  `pkg/cmd/server_*.go` (eight per-resource registrars plus the test-only
  `registerE2ERoutes`, a no-op unless `RECALL_E2E=1`; all wired in `server.go`)
  and the export/import bundle cluster, now in `pkg/bundle` behind the
  `pkg/app/bundle_alias.go` re-exports (`ExportBundle` / `ValidateBundle` /
  `App.ImportMatches` → `bundle.Export` / `ValidateBundle` / `Import`; the old
  `importJSONv1` / `importDataCSV` dissolved in the 2026-06-26 native-backup
  refactor). These *look* like duplication but share only the `(apiMux, a)`
  registrar signature — the bodies have diverged (SSE stream vs named-handler
  CRUD vs inline closures), so the per-resource-file split is deliberate
  structure, not accidental repetition with anything mechanical left to
  extract. YAGNI still applies: prefer a couple of extracted helpers over a
  speculative framework if a genuine shared shape ever emerges. A tracking
  note, not a mandate. (Re-evaluated 2026-07-06: count corrected 4→9; bundle
  inventory refreshed.)
- **The remaining `as unknown as` casts** (the Wails `Call.ByName` transport
  cast and the SSE error-path `callback(null as unknown as T)` in `api.ts`, the
  `mountWidget` partial-dossier fixture + the `mount()` overload cast, the
  `vitest.setup.ts` fetch shim, the ECharts series union in `TrendChart.vue`)
  are legitimate type-boundary casts. The one genuine type-lie (`enterEditMode`
  cast from KeyboardEvent to MouseEvent) was fixed. (Re-evaluated 2026-07-06:
  enumeration completed with the two `api.ts` casts + the fetch shim.)
- **Considered breaking redesigns — declined.** (1) Collapsing the five per-type
  parent tables into one `screenshots` table with a `type` discriminant — **keep
  the split**: the columns are meaningfully different per type, a unified table
  would be wide/sparse with type-conditional NULLs (worse 3NF), and the per-type
  split enables the EAD-signature bridge cleanly. (2) `unmatched-<filename>` /
  `ambiguous-<filename>` `match_key` sentinels — **keep** the filename coupling:
  they're explicit pre-resolution sentinels (a real `match-<ts>` key is minted on
  resolution) and transient, and the filename body is now base64url-encoded so the
  whole key is genuinely URL-safe. (RFC 9457 `problem+json` error bodies, previously
  deferred here, shipped — every 4xx/5xx is now a problem object.)
- **`pkg/probe` (~58%) stays thin structurally, not for want of a test.** Its
  uncovered `firstExisting` / `resolveSteamScreenshots` / `CandidateSources` are
  Windows-only screenshot-source resolution — `CandidateSources()` returns `nil`
  off-Windows and `resolveSteamScreenshots` is a Windows-registry walk stubbed
  out by build tags, so all three are unreachable through the public surface on
  the Linux CI runner. Don't pad for a percentage; the consequential gap (the
  `pkg/aggregate` read-path, now ~90%) was the one worth lifting. (Re-evaluated
  2026-07-06: `pkg/applog` left this bullet — the panic-recovery / on-disk-log
  work added public-surface tests of `RecoverPanic` / `AttachFile` / `Init`,
  taking it to ~85%.)
- **External CI flake** — the WebKit `match-detail-panel` e2e timeout is
  environmental (WebKit on the ubuntu runner; the spec itself is a
  deterministic regression guard, and `@playwright/test` stays pinned at exact
  1.60.0 because 1.61's Linux WebKit crashes the suite); not fixable in code —
  re-run the job. (Re-evaluated 2026-07-06: the schemathesis half of this entry
  was paid — the Hypothesis seed is now pinned in
  `scripts/ci/check-api-drift.sh`, so a red schemathesis run reproduces locally
  and is worth chasing, not re-running.)

## 5. Activate the schema-migration path — the deliberate last 1.0 commit

`NewSQLStore` sets only `PRAGMA foreign_keys = ON` (`pkg/db/store.go:250`); there
is no `PRAGMA user_version`, and the migration runner is scaffolded-but-inert —
`pkg/db/migrate.go`'s `applyMigrations` is a no-op and `pkg/db/migrations/` ships
no `.up.sql`/`.down.sql` pairs. Today every incompatible schema change is
"wipe the dev DB and relaunch" (documented in `.claude/rules/database.md`).

That's the correct pre-1.0 stance, but it stops being acceptable the moment real
users have data: the **first** post-1.0 schema change needs a migration path that
doesn't exist yet. Do it as the **last** commit before the 1.0 tag, once the
schema shape is final:

1. Reconcile this plan with the shipped framework: `pkg/db/migrate.go` tracks
   applied versions in a `schema_version` **table** (an earlier revision of
   this item said `PRAGMA user_version`, which the runner never used). Adopt
   the table as the contract or change the runner — before baselining.
2. Seed a baseline `0001_init.up.sql` / `.down.sql` from the current
   `pkg/db/schema.sql` — get it *exactly* matching the shipped schema or existing
   installs mis-migrate.
3. **Freeze `schema.sql` at that exact baseline.** `applySchema` runs BEFORE
   `applyMigrations` on every open, so a post-1.0 edit to `schema.sql` without
   a paired migration leaves upgraded installs missing the change while
   fresh-DB tests stay green (the silent failure mode); pairing the same
   change in both places duplicate-column-bricks fresh installs instead. The
   "adding a field" workflow moves to versioned migrations only.
4. Wire the existing `VACUUM INTO` machinery (`pkg/db/backup.go`) as an
   automatic pre-migration snapshot so a bad migration can't eat the only copy
   of a user's history.
5. Flip `applyMigrations` live so versioned pairs apply on open.

**Effort:** M. **Risk:** High — on-disk schema management. Deliberately sequenced
last so the schema is frozen before the baseline is captured.

## Out of scope — deliberately not building

So a future pass doesn't re-propose them:

- **Real desktop-runtime e2e for Wails** — the `EventsOn`/`EventsOff` bridge,
  native dialogs, and watcher are only exercised on the released desktop app; a
  `wails dev` + CDP driver is cross-platform-fragile and not worth the harness
  until an actual regression bites.
- **Analysis / coaching-insight dashboard tab** — removed; per-hero/per-session
  insight ideas, if they return, surface inside the Matches dossier, not a separate
  tab. (Speculative ideas live in `FEATURES.md`.)
- **Drag-to-reorder leaf rows** — matches are immutable history ordered by
  `parsed_at` / `finished_at`; reordering would lie about when they happened.
- **Match comparison side-by-side view** — the detail panel is single-match; if
  comparison earns its way back it's "tabs inside the panel," not dual inline.
- **Match-deletion confirmation modal** — the two-click confirm-then-act pattern in
  `MatchCardDanger.vue` is already correct UX.

## Verified and dismissed — do not re-open

A first automated review pass produced confident-but-false findings; each was
checked against source and is false. Catalogued so they aren't re-chased:

| Claim | Reality |
|---|---|
| `App.vue` is ~2,221 LOC / a god-shell | **168 lines** — clean thin shell. |
| 15 `v-for` missing `:key` (blocking) | Grep artifact; keys are present. Vue rules + `vue-tsc` would block a real miss. |
| Hard-delete 204-vs-404 drift | None. The `delete` block is 204/400/500; the 404 is `GetMatchByKey`'s, which correctly 404s. |
| `POST /matches` lacks roster validation | `CreateManualMatch` validates → `ErrUnknownMap`/`ErrUnknownHero` (409). |
| Missing enum `CHECK` constraints | Present on `leaver`/`reviewed_by`/`queue_type`/`play_mode`/`result`; `rank_modifiers` was the only gap and is now fixed. |
| `screenshots_dir` RESTRICT is "too protective" | Deliberate, documented invariant; the GC path is now in place. |
