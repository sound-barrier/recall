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
attach in `pkg/aggregate`, 75% → ~90%); the named infra packages that stay
thin do so structurally, not for want of a test (see §3). Everything else
below is a catalogued section, deliberately accepted (§3), or out of scope.

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
- **`AboutModal.vue` (~647) and `MatchLeafRow.vue` (~637)** — adjudicated
  2026-07 (the last of the never-adjudicated four). AboutModal's logic is
  already maximally extracted (`useGameDataUpdate`, `useModalFocusTrap`, the
  `UpdateDiffManifest` child); its bulk is the `update-check-modal-*` chrome
  shared verbatim across both update sections, and the only nominal seam
  would duplicate that shared chrome. MatchLeafRow is ~370 lines of
  irreducible per-row grid CSS + dense 7-cell markup with all logic in
  `match-helpers`/`match-label-helpers`/`search-query`; its map/hero-block
  seams share the `.leaf-filter-cell` funnel chrome and would each thread
  6-7 props — the MatchJournal "net worse" precedent. `MatchHeroModeBand`
  needed no ruling: the Phase-3 `BandHeaderControls` extraction already put
  it at ~490. `MatchesTable` was the one with a real seam left — its
  ~100-line cell drag-select pointer machine moved to `useCellDragSelect`
  (script now ~145 lines; the ~570-line residual is table chrome under this
  same exemption).
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
- **In-app self-update ships Windows + Linux only, three accepted gaps.** The
  Wails v3 `pkg/updater` flow (About dialog → Install → SHA256SUMS-verified swap
  → Restart) is deliberately gated off in three cases, all surfaced to the user
  as the "Open release page" fallback (`can_self_update:false`): (1) **macOS is
  excluded until a signing story exists** — an unsigned in-place swap would break
  the Gatekeeper quarantine/notarization contract, and the maintainer's decision
  is no signing certs; the dev-machine OS keeps the manual download. (2) The
  **Windows HKCU `DisplayVersion` goes stale** after an in-app update (the
  installer writes it, the updater doesn't) until the next installer run —
  cosmetic, only visible in Add/Remove Programs. (3) **Linux swaps fail cleanly
  with EXDEV when `/tmp` is a separate filesystem** (tmpfs) from the binary — the
  updater's cross-device rename can't be atomic; it restores the backup and
  reports the error rather than relaunching. Upstream-gap candidate to file, not
  a bug in our integration. Dev builds and unwritable installs (legacy
  machine-scope Program Files, deb-managed `/usr/local/bin`) also take the
  fallback by the same `can_self_update` gate.
- **Report-only cyclomatic-complexity** — the step stays REPORT-ONLY by design,
  but the numbers previously recorded here had drifted badly. The 2026-07-02
  audit re-ran the sweep: frontend max is **50** (`compareCol` in
  `useTableSort.ts` — a flat 13-case column-comparator switch whose `??`
  fallbacks inflate the metric; accepted as a dispatch table), and the real
  signal is the `useMatchesNarrow.ts` cluster (`passesNarrow` 43,
  `clauseLabel` 33, `activeClauses` 25, `clearClause` 21). That cluster is the
  filter-clause enumeration spread — adding a dimension touches ~8 parallel
  lists across 5+ files — and it already shipped a bug (saved presets dropped
  the three newest dimensions; fixed in the Phase-0 PR). Its fix is the
  clause-registry refactor (section 8), not per-function splits. Go-side max
  (non-test): `writeFixture` 23, `parsePersonalStatCell` 17. Everything else:
  refactor only if a real readability/bug problem surfaces.
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
  split enables the EAD-signature bridge cleanly. (2) `unmatched-<filename>` /
  `ambiguous-<filename>` `match_key` sentinels — **keep** the filename coupling:
  they're explicit pre-resolution sentinels (a real `match-<ts>` key is minted on
  resolution) and transient, and the filename body is now base64url-encoded so the
  whole key is genuinely URL-safe. (RFC 9457 `problem+json` error bodies, previously
  deferred here, shipped — every 4xx/5xx is now a problem object.)
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
