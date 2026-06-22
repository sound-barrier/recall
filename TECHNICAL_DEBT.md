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
lint, schemathesis, CodeQL, gosec, govulncheck, cosign-signed provenance,
Playwright + axe). The pre-1.0 contract-fix + polish pass is **done** — the
annotation `DELETE` verb, the `rank_modifiers` `CHECK`, the `screenshots_dirs` GC,
the first-run readiness checklist + hide-undo toast, the `ClearMatches` doc note,
the oversized-SFC splits, the stale-doc + cyclomatic-complexity + discoverability
polish all landed.

**One item remains before the tag:** activate the migration framework (§5 — the
deliberate *last* 1.0 commit). The pre-tag coverage lift landed on the genuinely
consequential gap (the read-path sidecar/override attach in `pkg/aggregate`, 75% →
~90%); the named infra packages that stay thin do so structurally, not for want of
a test (see §3). Everything else below is deliberately accepted (§3) or out of
scope.

## 3. Consciously accepted — do NOT "fix" these without a new reason

Reviewed and deliberately left, so a future pass doesn't burn effort churning them:

- **`useMatchesDossierQueries.ts` (~696 lines) and `useMatchesNarrow.ts` (~539)**
  exceed the 500-line soft cap, but the bulk is a single cohesive dense function
  each — exactly what the file-size rule exempts. The narrow file's shared types +
  state factory were already split out (`matchesNarrow.types` / `.state`);
  fragmenting the remaining filter/query math would hurt cohesion for a number.
- **`MatchJournal.vue` (626).** The Note / Replay / Group / Tags cells share
  `.journal-cell` chrome + the `saved`-pulse `@keyframes`, and its script is
  already a thin call into `useMatchAnnotationEditor`. A cell can't be pulled into
  a child without that shared chrome: promoting it to a global `app.css` file (the
  worked-example pattern) would blow the initial-CSS budget (~270 B headroom, and
  the journal CSS rides a lazy chunk), so a child SFC would have to *duplicate*
  ~80 lines of chrome — net worse. Cohesive-shell exemption.
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
  style; `MatchesView` is the set-workspace composition shell. Cohesive-shell
  exemptions — the clean seams were already taken. (The other six oversized SFCs
  *were* split: MatchesDossierHead, MatchesArchiveDrawer, MatchDetailPanel,
  IgnoredFilesPanel, MatchesMembersList, ManualMatchModal.)
- **App.vue is a clean 168-line thin shell** (zero business logic). The remaining
  parse-run-state / profile / tour / first-run wiring is more entangled with the
  shell's load/error/nav functions; extracting it further is opportunistic Boy-Scout
  work, not owed. The thin-shell target is already met.
- **Report-only cyclomatic-complexity** — the highest remaining are `load()` (14)
  and `valueLabel` (11) in the frontend, and `parsePersonalStatCell` (17) in the
  parser. The lefthook complexity step is REPORT-ONLY by design: these are branchy
  by nature (an `allSettled` boot coordinator; dense OCR cell logic the rules
  exempt). `ExportDataCSV` and `SeedProfile` were already trimmed under 15.
  Refactor only if a real readability/bug problem surfaces.
- **DRY hotspots to *watch*, not pre-abstract** — the four near-identical
  `register*Routes` (`pkg/cmd/server_*.go`) and the export/import bundle cluster
  (`ExportBundle` / `importJSONv1` / `importDataCSV` / `ValidateBundle`). The
  densest duplication clusters, but YAGNI applies: prefer a couple of extracted
  helpers over a speculative framework, and only on a real third occurrence. A
  tracking note, not a mandate.
- **The remaining `as unknown as` casts** (`mountWidget` partial-dossier fixture +
  the `mount()` overload cast, the ECharts series union) are legitimate
  type-boundary casts. The one genuine type-lie (`enterEditMode` cast from
  KeyboardEvent to MouseEvent) was fixed.
- **Considered breaking redesigns — declined.** (1) Collapsing the five per-type
  parent tables into one `screenshots` table with a `type` discriminant — **keep
  the split**: the columns are meaningfully different per type, a unified table
  would be wide/sparse with type-conditional NULLs (worse 3NF), and the per-type
  split enables the EAD-signature bridge cleanly. (2) RFC 9457 `problem+json` error
  bodies — **defer**: plain-text `http.Error` is deliberate until a real
  machine-parsing need; if an integrator asks, add it under `/api/v2`, don't mutate
  v1. (3) `unmatched-<filename>` / `ambiguous-<filename>` `match_key` sentinels —
  **keep**: explicit pre-resolution sentinels (a real `match-<ts>` key is minted on
  resolution), URL-safe, the filename coupling is transient.
- **`pkg/applog` (~29%) and `pkg/probe` (~58%) stay thin structurally, not for
  want of a test.** `applog` is logger wiring — `Init` mutates global `slog`
  defaults against `os.Stderr` and `newHandler`/`formatFromEnv` are unexported, so
  the public surface offers little to assert without reaching into internals (which
  the test-public-surfaces rule forbids). `probe`'s uncovered `firstExisting` /
  `resolveSteamScreenshots` / `CandidateSources` are Windows-only path resolution —
  `CandidateSources()` returns `nil` on the Linux/macOS CI build, so they're
  unreachable through the public surface there. Don't pad these for a percentage;
  the consequential gap (the `pkg/aggregate` read-path) was the one worth lifting.
- **External CI flakes** — the schemathesis random-seed failures on the PUT
  settings endpoints and the WebKit `match-detail-panel` timeout are
  non-deterministic and not fixable in code; re-run the job.

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

1. Set `PRAGMA user_version` in `NewSQLStore`.
2. Seed a baseline `0001_init.up.sql` / `.down.sql` from the current
   `pkg/db/schema.sql` — get it *exactly* matching the shipped schema or existing
   installs mis-migrate.
3. Flip `applyMigrations` live so versioned pairs apply on open, and switch the
   "adding a field" workflow to versioned migrations.

**Effort:** M. **Risk:** High — on-disk schema management. Deliberately sequenced
last so the schema is frozen before the baseline is captured.

## Out of scope — deliberately not building

So a future pass doesn't re-propose them:

- **In-app auto-updater** — Wails v2 has no in-app binary updater; the masthead
  flow stays "Check for updates → Open release page." Revisit only if the Wails
  updater story changes.
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
