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

- **Table library — @tanstack/vue-table evaluated, declined (2026-08-09).**
  Evaluated during the hey-api + TanStack Query migration. It would replace
  ~330–400 lines of stable, tested composables (`useTableSort`'s multi-key
  stack, `useColumnResize`'s sizing state, `useMatchesSelection`) — and
  nothing else: the data table is always FLAT (grouping belongs to the leaf
  list), virtualization is a separate dep and `useVirtualWindow` also serves
  the leaf list, and the cell range-select/TSV clipboard, sticky columns,
  DOM-Range auto-fit, pivot engine, narrow-rail filter language,
  `usePersistedRef` persistence, and all OW-domain cell rendering stay
  hand-rolled either way. Cost: ~45–55 KB raw minified against a total-JS
  budget with ~5 KB working headroom, plus a third breaking rewrite of the
  persisted sort-stack shape (`recall.matchesTableSort` + `isSortStack` +
  the Custom-Sort popover contract). No other surface fits
  (CompareTable/EloLiftTable are static; the crosstab + heatmap bands are
  grid-selection surfaces, not sortable tables). **Revisit if** the table
  grows column visibility/ordering/pinning UI, per-column filtering, or a
  second sortable data-grid surface appears.

- **TS 7.0-readiness: one `stableTypeOrdering` hit, in generated code
  (2026-08-09, re-measured with `tsgo`).** Run `task typecheck-next`.
  Under TS 6's `--stableTypeOrdering` (which previews 7.0's deterministic
  type ordering) the whole authored codebase is clean; the single error is
  in hey-api's bundled runtime (`src/client/core/params.gen.ts` —
  `unknown` not assignable to `Record<string, unknown>`). Generated code
  isn't hand-patched (the gen-types drift gate would fight it), so the
  trigger is the next deliberate `@hey-api/openapi-ts` bump — 0.99.0 is
  currently both the newest release AND the newest one clearing the 7-day
  `.npmrc` cooldown, so there is nothing to bump to yet.

  **Measured, not assumed:** a one-off `npx -p @typescript/native-preview
  tsgo --noEmit` (the actual TS 7 checker) reports **17 errors, all in
  `.ts` test files, all one root cause** — tsgo resolves `.vue` imports
  but not their prop types, so every `mount(Component, { props })` fails
  against the generic `VNodeProps`. **Zero errors in authored production
  code, and zero in `src/client/`** — including `params.gen.ts`, which
  means that `stableTypeOrdering` hit does NOT reproduce under real 7.0
  semantics and is likely a 6.0-flag artifact rather than a 7.0 blocker.
  So a `tsgo` shadow CI job stays deferred (it would report 17 lines of
  SFC-prop noise and nothing else) until the native compiler gains SFC
  support — but the earlier note that tsgo "would fail on every SFC
  import" was wrong: imports resolve fine, prop TYPES do not. Adding
  `@typescript/native-preview` as a devDependency needs approval and
  buys nothing until that lands.

  The `-p` in that command is load-bearing: the package's only bin is
  named `tsgo`, so `npx @typescript/native-preview tsgo …` runs that bin
  and passes the leftover word `tsgo` as an INPUT FILE — which suppresses
  tsconfig.json and reports `TS5112` having checked nothing.

- **Post file-size wave (2026-08-10): what stays over the 500-line soft cap.**
  The sibling-stylesheet split (`<style scoped src="./x.css">` — hash-scoping
  and lazy-chunk placement verified byte-identical in the built assets) plus
  targeted script/data extractions took every previously-exempted oversized
  file under the cap (MatchJournal 326, MatchStatusChoosers 232, MatchLeafRow
  286, AboutModal 296, MatchMapRoleBand 493, MatchesTable 320, TourCallout
  411, NarrowPopover 474, FormCompareView 424, stores/matches 366,
  useDashboardLayout 329, useEloCalculator 437, KeyboardShortcutsModal 351;
  `useMatchesDossierQueries` sits at 343 since the kernel extraction), so the
  old per-file exemptions are paid and deleted. What remains, argued fresh:
  `MatchesView.vue` (698: ~369 script / ~208 template / ~119 style) is the
  set-workspace composition shell — the script is pure wiring (store reads,
  the CardStateApi/grouping/keyboard bundles, the four dossier `provide()`
  calls; the dossier itself now lives in the matches store, so the old
  "useWeekStart must live here" rationale is obsolete) and the only seam
  left is splitting the workspace layout itself; growth trigger ≥750 lines
  or any non-wiring logic landing in its script. `api.ts` (529) is the
  named-function facade over the generated SDK — 61 one-call wrappers,
  complexity 1 each; the file IS the one-page wire-surface listing, and
  splitting it buys indirection for zero win. `match-dossier-aggregate.ts`
  (594) and `match-trends-helpers.ts` (519) are dense pure-helper kernels
  (the dossier aggregation pass; the trends chart math) whose siblings
  (`match-dossier-tally`, `match-time`/`label`/`sample-helpers`) already
  hold the separable concerns — splitting what's left fragments one
  aggregation layer for a number, the same argument the retired
  useMatchesDossierQueries bullet made, still true one level down. Test
  files over 500 (useMatchesDossier.test 1949, SettingsView.test 996,
  useMatchesNarrow.test 845, MatchDetailPanel.test 609, MatchesView.test
  602, useDashboardLayout.test 579) stay whole: a suite mirrors its
  surface, and splitting one by line count scatters a single surface's
  coverage story.
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
- **Total-JS bundle headroom is ~550B (2026-08-10)** — the file-size wave's
  module extractions spent ~645B of indirection against the cap in
  `scripts/ci/check-bundle-size.sh` (313442/319000 initial, 1592448/1593000
  total after the wave). The next non-trivial JS addition will trip the
  gate; bump the budget deliberately with a history row when it does —
  don't shave a feature to dodge a number the wave spent on structure.
- **External CI flake** — the WebKit `match-detail-panel` e2e timeout is
  environmental (WebKit on the ubuntu runner; the spec itself is a
  deterministic regression guard, and `@playwright/test` stays pinned at an
  EXACT version so a bump is always deliberate rather than a silent range
  resolve); not fixable in code — re-run the job. (Re-evaluated 2026-07-06: the
  schemathesis half of this entry was paid — the Hypothesis seed is now pinned
  in `scripts/ci/check-api-drift.sh`, so a red schemathesis run reproduces
  locally and is worth chasing, not re-running.) (Re-evaluated 2026-08-03: the
  pin moved 1.60.0 → 1.62.0. It had been held at 1.60.0 because 1.61's Linux
  WebKit crashed the suite; 1.62 doesn't — both WebKit specs pass locally and on
  CI. The WebKit timeout above is a SEPARATE, still-live environmental flake and
  is not fixed by that bump.)

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

## 11. tests/e2e sits outside every type-check program

`tsconfig.json` includes `src/**` only, so `frontend/tests/e2e/*.spec.ts`
is type-checked by nothing — not `vue-tsc`, not the type-aware ESLint
program. The quality campaign found ~30 latent type errors there (one was
a cast to a nonexistent `Mode['type']` field that had silently asserted
nothing) and fixed only the files it touched. Options when paying:
a dedicated `tsconfig.e2e.json` + a `task typecheck-e2e` step folded into
`task typecheck` and CI's test-unit job, or widening the main program if
Playwright's types don't collide with the app's DOM lib settings.
**Effort:** S–M. **Risk:** low — additive gate; the errors are in specs,
not shipped code.

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
| Missing enum `CHECK` constraints | Present on `match_annotation_leavers.side`/`match_annotation_throwers.side`/`reviewed_by`/`queue_type`/`play_mode`/`result`; `rank_modifiers` was the only gap and is now fixed. |
| `screenshots_dir` RESTRICT is "too protective" | Deliberate, documented invariant; the GC path is now in place. |
