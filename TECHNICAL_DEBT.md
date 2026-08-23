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
catalogued section from that audit has been paid (the decomposition round carved
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
thin (`pkg/probe`) does so structurally, not for want of a test (see §3).

**Sections 11–20 were the 2026-08-22 audit against the restructured standards**
(root `CLAUDE.md` + the two language files + eight `.claude/rules/*.md`). Seven
are paid and deleted: §11 untyped discriminants, §12 diverged duplication, §13
the Narrow panel's duplicated open-state, §14 the cheat-sheet with no parity
test, §16 server state outside the query layer, §17 transposable signatures,
§19 dead weight. **§15, §18 and §20 remain** — each for a stated reason rather
than for want of time, and each below.

The campaign's durable half is the gates, because every one of those seven was
found by reading rather than by a build: a `default` arm no longer satisfies
`exhaustive` (Go) or `switch-exhaustiveness-check` (TS); dependency-cruiser
holds the module graph, which is now free of runtime import cycles (45 → 0) and
of components reaching for the api seam; jscpd ratchets duplication;
`check-test-exports.sh` closes the hole that let seven dead `export_test.go`
entries accumulate with no linter able to see them. All are in `task lint`
**and** the CI lint job — the umbrella task alone would not have run them,
which is the §18 lesson applied to §18's own fix.

Everything else below is a catalogued section, deliberately accepted (§3), or
out of scope.

## 3. Consciously accepted — do NOT "fix" these without a new reason

Reviewed and deliberately left, so a future pass doesn't burn effort churning
them. Last re-evaluated **2026-07-06** — every bullet verified against source;
changed bullets carry an inline re-evaluation note:

- **What is left in `pkg/app`, and why it stays (2026-08-16).** The
  decomposition took it from 54 files / 7,607 LOC to 47 / 5,673 via six leaf
  packages (**50 / 6,480 as of 2026-08-22** — the coaching work since added
  `focus.go`, `self_review.go` and `coach_replay.go`, each a leaf shell on the
  same template) (`pkg/sse`, `pkg/seed`, `pkg/matchedit`, `pkg/snapshot`,
  `pkg/screenshot`, `pkg/release`), on the template the earlier carves set:
  the leaf takes `db.Store` plus plain values, never `*App`. What remains is
  the shell, and it is meant to remain. **The five mutex-guarded clusters**
  (settings, tesseract, watcher, parse, coach session) each hold state the
  lock exists to protect; moving the logic out from under the lock is how a
  carve introduces a race that no test would show. **The parse pipeline** is
  mutually recursive — carving it needs a ~10-method `ParseHost` interface,
  which is the interface-pollution smell CLAUDE.md names, not a leaf package.
  **`app_wails.go` / `app_server.go`** are the desktop-vs-server seam; the
  pair is the point. **The nine `*_alias.go` shims** (445 LOC) are
  load-bearing rather than residue: `pkg/cmd` maps 43 `app.Err*` sentinels to
  problem+json statuses inline across seven files, and a sentinel re-declared
  instead of aliased is a silent 500 with no compile error — pinned by
  `pkg/cmd/problems_ladder_test.go`, whose own completeness gap let exactly
  that hide until it was found by mutation.

  **Tesseract stays for a security reason, not a cohesion one.**
  `safePathChars` is the CodeQL-recognized sanitizer for two
  `go/command-injection` + `go/path-injection` sinks living in two files, and
  carving tesseract alone puts the sanitizer on the far side of a package
  boundary from one of its sinks. That is a security review with its own
  before/after CodeQL run, not a decomposition commit. **Revisit if** a
  cluster's mutex disappears, or if the parse pipeline stops being mutually
  recursive.

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

- **Post file-size wave (2026-08-10; re-measured 2026-08-22): what stays
  over the 500-line soft cap.**
  The sibling-stylesheet split (`<style scoped src="./x.css">` — hash-scoping
  and lazy-chunk placement verified byte-identical in the built assets) plus
  targeted script/data extractions took every previously-exempted oversized
  file under the cap (MatchJournal 326, MatchStatusChoosers 232, MatchLeafRow
  286, AboutModal 296, MatchMapRoleBand 493, MatchesTable 320, TourCallout
  411, NarrowPopover 474, FormCompareView 424, stores/matches 366,
  useDashboardLayout 329, useEloCalculator 437, KeyboardShortcutsModal 351;
  `useMatchesDossierQueries` sits at 343 since the kernel extraction), so the
  old per-file exemptions are paid and deleted. What remains, argued fresh:
  `MatchesView.vue` is **559** (2026-08-22; was 508 at 2026-08-17, from 698):
  the style block went
  to a sibling sheet, and three cohesive clusters left the script for
  composables that each have one reason to change that is not this view's —
  `useMatchesRowActions` (the right-click menu's state machine AND what each
  item does, which is the menu's contract), `useMatchesBulkActions` (live
  selection, the archive drawer's parallel selection, and the move picker they
  share), and `provideMatchesContext` (the five dossier/narrow provides, one
  decision about how the widget tree gets its data). What is left is the
  workspace composition itself — ~200 lines of wiring and ~210 of template —
  and the only seam remaining is splitting the layout, which would trade one
  readable shell for three partial ones. Growth trigger unchanged at ≥750
  lines, or any non-wiring logic landing in its script.

  **`api.ts` has outgrown its own argument and is re-scoped, not re-accepted
  (2026-08-22).** It was accepted at 529 lines / 61 wrappers as "the one-page
  wire-surface listing." It is now **865 lines / 97 wrappers**. The complexity
  claim still holds — each is a one-call wrapper — but the justification was
  never *low complexity*, it was *one page*, and 864 lines is not one page.
  Rather than launder a 63% overrun as a fresh acceptance, this is now tracked
  as owed work in §18: split along the section comments already dividing the
  file, or re-argue the number through the documented bump procedure.
  `match-dossier-aggregate.ts` (594, now at `src/match/dossier/`) and
  `match-trends-helpers.ts` (**623**, was 519) are dense pure-helper kernels
  (the dossier aggregation pass; the trends chart math) whose siblings
  (`match-dossier-tally`, `match-time`/`label`/`sample-helpers`) already
  hold the separable concerns — splitting what's left fragments one
  aggregation layer for a number, the same argument the retired
  useMatchesDossierQueries bullet made, still true one level down. Test
  files over 500 (re-counted 2026-08-22: useMatchesDossier.test 1972,
  useMatchesNarrow.test 1189, SettingsView.test 988, MatchesView.test 945,
  MatchDetailPanel.test 620, useDashboardLayout.test 579) stay whole: a suite mirrors its
  surface, and splitting one by line count scatters a single surface's
  coverage story. The three BATCHED widget suites were the opposite case and
  are now split per-widget (2026-08-17): FormWidgets, ModifierWidgets and
  MomentumWidgets each covered several unrelated widgets, so they mirrored a
  PR rather than a surface. That split was also the stated precondition for
  reopening whether `dashboard/widgets` wants a family taxonomy; it was
  reopened and the answer stands — see the reasoning above that budget entry.

  **The Go side of this cap was never argued, and twelve files sit over it
  (2026-08-22).** Every exception above is a frontend file; §3 has named zero
  Go files since the cap was written, which is not a finding that Go is
  smaller — it is a blind spot. Unlisted and over 500:
  `pkg/db/store_self_review.go` 621 · `pkg/aggregate/attach.go` 577 ·
  `pkg/db/dbtest/fake.go` 562 · `frontend/src/stores/coach.ts` 550 ·
  `BulkActionBar.vue` 547 · `pkg/cmd/server_coach.go` 545 ·
  `pkg/db/store_types.go` 536 · `pkg/profiles/move.go` 523 ·
  `match-momentum-helpers.ts` 511 · `MatchHeatmapHeader.vue` 509 ·
  `MatchMapRoleBand.vue` 504 · `ProfileSwitcher.vue` 502. Four of the Vue
  files are mostly irreducible markup and CSS (BulkActionBar's script is 101
  lines, ProfileSwitcher's 34) and are the case the cap explicitly forgives;
  the Go four and `stores/coach.ts` are not. **`MatchMapRoleBand.vue` is the
  cautionary one**: it appears in the *paid* list above at 493 and has since
  regrown to 504 — a file dropped under the line and then quietly crossed back,
  which is exactly the per-file-trigger failure the Package-size rule records.
  Two more are mine: the replay-code campaign took `stores/coach.ts` 446→550
  and `server_coach.go` 453→545 and passed nine green local runs, because this
  cap is prose, not a gate. Tracked as owed work in §18.
- **App.vue is a clean 189-line thin shell** (zero business logic — it reads a
  few store refs, wires the App-shell composables, and renders chrome + one
  view; the parse-run-state / profile / tour / first-run wiring lives in the
  `composables/app/` seam, not the SFC). Extracting further is opportunistic
  Boy-Scout work, not owed. The thin-shell target is already met.
  (Re-evaluated 2026-08-22: 168→177→189.)
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
  cast and the SSE error-path `callback(null as unknown as T)` in
  `api-platform.ts`, the `renderWidget.ts` partial-dossier fixture + its
  Testing Library `render()` overload cast, the `vitest.setup.ts` fetch
  shim, the ECharts series union in `TrendChart.vue`)
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
- **Bundle headroom stays thin, and the caps live in the gate, not here.**
  The budgets are `MAX_INITIAL_JS_BYTES` / `MAX_TOTAL_JS_BYTES` (and the two
  CSS twins) in `scripts/ci/check-bundle-size.sh` — **read them there.** This
  bullet used to quote `313442/319000` and `1592448/1593000`; both were two
  budget generations stale by 2026-08-22, which is the drift §18 is about, in
  the one bullet that had a gate to defer to. The standing rule is what
  survives re-reading: headroom is routinely under 1KB, so the next
  non-trivial JS addition trips the gate — bump the budget deliberately with a
  history row rather than shaving a feature to dodge a number. **The gate is
  not in `task lint`**, so it can only fail in CI; build before you assume.
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

`NewSQLStore` sets only `PRAGMA foreign_keys = ON` (`pkg/db/store.go`); there
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

## 15. The documented store-reading migration is unfinished

**Priority: MED. Effort: M.** `frontend/CLAUDE.md` states the target plainly:
components read the stores directly; App neither prop-drills down nor wires
mutation emits back up.

- **`SettingsSections.vue`** is a 212-line store-to-props shim over seven
  sections — and the *same template* renders `<SettingsProfiles />`,
  `<SettingsWindow />` and `<SettingsCoach />` with **zero props**, which is the
  documented pattern. One file demonstrating both the target and the miss.
- **Row-interaction emits** are relayed verbatim through `MatchesMembersList`
  (twice) and `MatchesTable`, neither of which reads them — they exist to carry
  `row-context` up to `useMatchesRowContext`, which `MatchesView` owns.

**Deliberately NOT done in the 2026-08-22 remediation**, and the reason is the
size rather than the difficulty: it is seven component migrations plus their
tests, and `SettingsView.test.ts` — 988 lines, the largest suite in the repo —
drives the whole surface through a `renderSettings({ props })` harness built
around exactly the prop-drilling being removed. Folding that into a PR that
already carried nine sections would have made the riskiest change the one
reviewed last and least. The row-context relay is the same shape one layer
down: the composable that owns the state is provided by `MatchesView`, so
letting a row call it directly is the same migration, not a smaller one.

**Do it as its own PR**, sections first and the test harness with them.

## 18. `api.ts` and the unlisted 500-line files

**Priority: MED. Effort: S–M.** What is left of the drift section after the
2026-08-22 remediation. The stale pointers, the false `db.CoachStore` comment
and the fifteen mis-named `SettingsView` cases are fixed; §3's numbers were
re-measured when they were written. These two are judgment calls rather than
corrections, which is why they outlived the rest.

1. **`api.ts` is 865 lines / 97 wrappers and has no accepted argument.** §3
   used to accept it at 529/61 as "the one-page wire-surface listing"; that
   sentence is not true of 865 lines, and §3 now says so rather than pretending
   otherwise. Split along the section comments already dividing the file
   (matches, settings, coach, review, system), or re-argue the number through
   the documented bump procedure. What it must not do is sit un-argued.
2. **Sixteen files are over the 500-line soft cap and §3 argues four of them.**
   The Go side has never been argued at all — `store_self_review.go` 624,
   `attach.go` 577, `store_types.go` 567, `dbtest/fake.go` 562,
   `server_coach.go` 545, `move.go` 523 — and neither has `stores/coach.ts`
   550. Four of the Vue files are irreducible markup and CSS and are the case
   the cap forgives. `MatchMapRoleBand.vue` is the one to watch: it appears in
   §3's *paid* list at 493 and is 504 now, which is a file crossing back after
   being marked done.

   Note that three of these grew in this campaign for reasons the cap would
   endorse: `store_types.go` 536 → 567 and `store_self_review.go` 621 → 624
   took the self-review ref types and their signatures, which is what §17 asked
   for. Growth with a reason is not the problem the cap is about; growth nobody
   noticed is.

## 20. 30 of 123 directories sit at their size ceiling

**Priority: MED. Effort: a decision, not a patch.** Zero-headroom is deliberate
and correct — it is what makes the gate trip on the *first* file past the line.
But a quarter of the tree sitting *at* the line means most future changes open a
budget conversation before they open a code review, and the two legitimate
answers (split vs. bump) are not interchangeable.

Some of the 30 are genuine split candidates; others are budgets that were set at
the directory's count rather than at its responsibility, which is the failure
mode the rule warns about from the other direction. Telling them apart is a
directory-by-directory judgment call.

Re-measured 2026-08-22 after the remediation: 29 → 30. The campaign added
`ProbeChip.vue` (a bump, argued in `package-size-budget-history.md`) and moved
`useMatchClock` into the feature that reads it. **Schedule it as its own pass** —
treating it as a patch is how a folder silently regrows what it just shed, and
it should run after §15, which moves files again.

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

**Settled by the 2026-08-22 remediation** — these were considered and rejected
with measurements, so the next pass does not re-derive them:

- **`dupl` is not the gate for Go duplication.** 12 clones, none of them the
  ones §12 charged (`checkMomentRoom` / `sortOrderFor` are ~10-line functions,
  under any usable token threshold — measured at 150/100/75/50, and §12 never
  appears). All 12 hits are the additive-column families, which diff clean apart
  from column names. Enabling it buys twelve `//nolint` on correct
  file-per-concern code.
- **jscpd is a ratchet, not a finder.** `SettingsEngine.vue` — a §12 item —
  appeared in **zero** of its clones. Exact-clone detection cannot see code that
  has already diverged, which is precisely what §12 charged those files with. It
  is gated at the measured percentage so new duplication cannot land; that is
  its whole job.
- **`useMutation` is not this codebase's idiom.** The §16 writes were built on
  vue-query mutations first and reverted: there is no `useMutation` anywhere
  else here, the established shape is a plain exported async function that
  awaits the write and then invalidates. One extra `await` layer also shifted
  two manual-match tests by a microtask, which is the kind of cost an unproven
  pattern imposes on everything around it.
- **Four of the five `shared/` files §19 listed did not move**, and should not:
  `useGlobalKeyboard` sits in a cohesive keyboard-and-focus folder whose sibling
  has nine importers, and `CommandPalette.vue` / `useSummaryThumbnail` would
  move into directories already at their ceiling. Only `useMatchClock` was a
  clean move. A single-consumer count is not on its own a reason to split.
- **`parser.go`'s probe names and `schema.go`'s column names are not the
  screenshot-type vocabulary**, though they spell some of the same words —
  the probe table says `"all-heroes"` with a hyphen. Both were left alone when
  §11 typed the real vocabulary.

**Swept clean by the 2026-08-22 standards audit** — recorded so the next pass
doesn't re-derive them. Each was checked against source, not assumed:

- **Zero stutter across all 23 packages** — no `parser.ParserFoo`,
  `db.DBStore`-shaped names anywhere. Scanned exhaustively, 0 candidates.
- **No vacuous or internals-coupled tests** — no assertion-free test bodies, and
  no Go test reaching an unexported identifier outside the one sanctioned
  `export_test.go` shim per package. (The shims themselves have dead entries —
  that is §19, a different problem.)
- **No unjustified `_ = f()` error drops**, no `any`-as-a-shortcut in authored
  Go, no TypeScript `enum`, no index-as-key on a reorderable list, and every
  store bundle correctly `markRaw`'d.
- **No shadow state without a sync contract** other than the Narrow panel's,
  which is §13.
- **The `match/markdown` and `widget-config-schema` switches are exhaustive with
  no `default` arm** — they are correctly *not* registries. A `switch` that the
  `exhaustive` linter genuinely guards is the better tool; only the ones wearing
  a `default` (§11) have lost that protection.

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
