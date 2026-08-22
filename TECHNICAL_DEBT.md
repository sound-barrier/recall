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

**Sections 11–20 are new (2026-08-22)**, from the first audit against the
restructured standards (root `CLAUDE.md` + the two language files + eight
`.claude/rules/*.md`). `task lint` is green across four Go tag/GOOS combinations
plus ESLint, stylelint, knip and vue-tsc, so **every mechanically enforced rule
already passes** — all ten sections are judgment-area debt, which is the only
kind a linter cannot hold. None blocks 1.0. Read them in priority order: §12's
`dbtest.Fake` vocabulary is a one-line fix and the cheapest item in the ledger;
§18 is the ledger auditing itself and was largely paid on arrival.

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
  `MatchesView.vue` is **560** (2026-08-22; was 508 at 2026-08-17, from 698):
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
  wire-surface listing." It is now **864 lines / 97 wrappers**. The complexity
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

## 11. Untyped discriminants dispatched without a registry

**Priority: HIGH. Effort: L.** The same smell in both languages, and in both
the `default` arm defeats the exhaustiveness check that would otherwise catch a
miss. Cited by symbol, not line — see §18 for why.

**Go.** `parser.ScreenshotType` returns a bare `string`
(`pkg/parser/classify.go`), and its six values — the five in
`screenshotTypeChecks` plus the `"unknown"` fallback — are re-spelled as string
literals across **13 files in 6 packages**. Adding a seventh type means editing
all of them, and *nothing catches a miss*: every switch carries a `default` that
absorbs the unknown type as `"unknown"` and writes a garbage row. Naming the
type would **not** recruit the `exhaustive` linter — `.golangci.yml` sets
`default-signifies-exhaustive: true`, so a `default` arm silently satisfies it.

The guard that looks like it covers this does not.
`TestApp_ParseScreenshots_DispatchesEachScreenshotType`
(`pkg/app/parse_orchestration_test.go`) is a hand-written table of four cases —
`teams`, `personal`, `rank`, `unknown`. **`summary` and `all_heroes` are
absent.** The name promises a completeness check the body has never performed,
which is worse than no test: it reads as coverage at review time.

**Frontend.** `AggFn` is a 7-member union (`match/pivot/pivot-aggregate.ts`)
dispatched by **5 switches** plus two hand-kept lists in `useMatchPivot.ts`.
Four arms have a `default:` or a trailing `return null`, so adding `'median'`
compiles clean, routes through `foldMeasure()` to `null`, and paints an **empty
column**. The user sees nothing wrong; the build is green.

**Remedy** in both cases is the pattern the repo already owns — a registry keyed
by the discriminant plus a completeness test, as in `store_vocabulary_sync_test.go`,
`NARROW_CLAUSES` and `WIDGET_REGISTRY`. A Go registry *map* loses the
`exhaustive` check, so the paired completeness test is not optional. The Go half
touches 5 packages, so per *Working style* its approach needs outlining before
any code is written.

## 12. Duplication past three that has already begun to diverge

**Priority: HIGH. Effort: S–M.** Not "these look similar" — each of these has
measurably drifted, which is what converts a rule-of-three observation into owed
work.

- **`checkMomentRoom` / `sortOrderFor` ×3** — `pkg/app/coach_session.go`,
  `pkg/matchedit/moment.go`, `pkg/review/note.go`. `sortOrderFor` is
  byte-identical bar the slice element type. `checkMomentRoom` has drifted into
  **three different spellings**, and `pkg/review`'s copy is missing the
  `momentID != ""` guard the other two have. Not a live bug — `review.PutMoment`
  refuses an empty id upstream — but that is luck, not design, and the next
  caller doesn't inherit the luck. The generic idiom already exists two files
  away (`dropRowByFilename[T any]`).
- **`dbtest.Fake` holds a third focus-tag vocabulary** (`checkFocusTags` in
  `pkg/db/dbtest/fake_coach.go`) while `store_vocabulary_sync_test.go` says
  *"two in Go"* and references the Fake's copy **zero times**. Add a ninth tag
  correctly everywhere the sync test checks and the Fake rejects what production
  accepts — failing every `pkg/app` test with an error pointing at the wrong
  layer. This is *"a fake that cuts corners is a broken fake"* with a one-line
  fix. **Do this one first**; it is the cheapest item in the ledger.
- **The probe chip ×3** — `SettingsView.vue`, `SettingsEngine.vue`,
  `SettingsFolders.vue`: the same three-line state machine and ~22 lines of
  identical markup each, whose a11y labels have **already diverged** ("Dismiss
  Tesseract detection result" vs "Dismiss detection result").
- **Click-to-filter dimensions across 4 files** — the six-dimension if-chain in
  `MatchesTable.vue` and `MatchesMembersList.vue` has already diverged in both
  ordering *and* fallthrough target (`pickRole` vs `pickResult`). Both are
  currently correct only because each is exhaustive over its own literal union.

## 13. The Narrow panel's open-state is duplicated, so four call sites click a CSS class

**Priority: HIGH. Effort: M.** One concept, two refs: `narrowOpen` in
`stores/ui.ts` and a second in `MatchesDossierHead.vue`, kept in sync by a pure
emit relay (`MatchesDossierHead` → `MatchesView`'s `@narrow-open` →
`uiStore.setNarrowOpen`). The store's copy only feeds `backgroundFrozen`; the
component's copy is the one that actually opens the panel.

Because `setNarrowOpen(true)` does not open anything, every other caller
synthesizes a DOM click instead:

- `useOnboardingTourBridge.ts` — `.dossier-actions .dossier-btn.primary`
- `useOnboardingTourBridge.ts` — `#narrow-popover .np-close`
- `useAnchorToast.ts` — `[data-narrow-trigger]`
- `useGlobalKeyboard.ts` — `getElementById('narrow-popover')`, then that same
  `.dossier-actions .dossier-btn.primary` selector

They already **disagree on how to address the same button**: three reach for the
styling class, one for the `data-*` hook. `.dossier-btn.primary` is a *CSS*
class — renaming it, or making some other button in `.dossier-actions` the
`.primary` one, silently breaks the `/` shortcut, the anchor toast and the
onboarding tour, with a green build. A fix applied to one spelling leaves the
others broken. `useOnboardingTour.ts` carries a comment documenting the hack,
which is the tell that it was known and deferred rather than missed.

**Remedy:** collapse to the single store ref, make `setNarrowOpen` actually
open the panel, and delete all four DOM-click call sites.

## 14. The keyboard cheat-sheet is a parallel catalog with no parity test

**Priority: MED-HIGH. Effort: S.** `SHORTCUT_GROUPS`
(`keyboard-shortcuts.data.ts`, ~40 rows) and the real registrations in
`useGlobalKeyboard.ts` share no code and no test — `SHORTCUT_GROUPS` appears in
**zero test files**. A binding can be added, changed or removed with `task lint`,
`task test` and `task test-e2e` all green while the "?" modal keeps advertising
the old key. That is a **user-facing lie no gate can catch**, and the standards
name the remedy: when a lookup cannot be collapsed into the thing it describes,
*"pair it with a completeness test."*

## 15. The documented store-reading migration is unfinished

**Priority: MED. Effort: M.** `frontend/CLAUDE.md` states the target plainly:
components read the stores directly; App neither prop-drills down nor wires
mutation emits back up.

- **`SettingsSections.vue`** is a ~90-line store-to-props shim — and the *same
  template* renders `<SettingsProfiles />`, `<SettingsWindow />` and
  `<SettingsCoach />` with **zero props**, which is the documented pattern. One
  file demonstrating both the target and the miss, side by side.
- **Row-interaction emits** are relayed verbatim through `MatchesMembersList`
  (twice) and `MatchesTable`, neither of which reads them. The two paths through
  `MatchesMembersList` have already drifted stylistically from each other.

## 16. Server state read outside the query layer

**Priority: MED. Effort: S.** `GetCoachingSettings` is fetched directly from
`SettingsCoach.vue` and `SendToCoachModal.vue`, with **no entry in
`queries/keys.ts`** — the only server read in the app outside the vue-query
cache. So `SetCoachingSettings` has no key to invalidate, and the two surfaces
stay consistent only because the modal happens to re-fetch every time it opens.
It also opts out of the `meta: { banner }` error path, which is why one caller
hand-rolls `setErrorFromRaw` and the other swallows the error entirely.

**Not** part of this item: `SettingsDatabaseHealth.vue` reads the seam directly
too, but it is user-pulled diagnostics with a written rationale — a legitimate
carve-out, recorded here so the next audit doesn't re-flag it.

## 17. Signatures a transposition survives, and the casts covering them

**Priority: MED. Effort: S.** Adjacent same-typed parameters that the compiler
cannot tell apart.

- **`MomentRef` exists to kill a shape that is still live in five signatures.**
  `pkg/CLAUDE.md` names this exact case. `(reviewID, matchKey, momentID string)`
  survives in `pkg/app/self_review.go` (twice), on the **`db.Store` interface**
  (`store_self_review.go`), in its implementation, and in the Fake — and
  `PutSelfReviewMoment` takes the three loose strings and then *builds a
  `MomentRef` out of them*, which is the abstraction arriving one layer too late.
- **Four `as Set<string>` casts** in `matchesNarrow.clauses.ts` exist only
  because `matchesAnySide(sides, picked: Set<string>)` (`narrowPredicates.ts`)
  demands a *mutable* `Set` it never writes to, and `Set<T>` is invariant. The
  cast asserts the callee may `.add()` an arbitrary string into a
  `Set<LeaverPick>`. Widening the parameter to `ReadonlySet<string>` deletes all
  four casts and makes the contract honest.
- Also **`UpsertIngestedFile(filename, contentHash, duplicateOf string)`** — two
  of those are filenames from one namespace — and **`SetReviewAt(matchKey,
  reviewedBy, reviewedAt string)`**, whose two adjacent params differ by two
  characters and where a transposition writes a timestamp into `reviewed_by`
  with no `CHECK` constraint to stop it.

## 18. The ledger and the standards have drifted from the code

**Priority: HIGH. Effort: S.** Cheap to fix and actively misleading — the worst
combination. Most of this section was **paid in the commit that added it** (§3's
numbers were re-measured and corrected, §5's rotted line citation became a
symbol reference); what stays open is listed at the bottom.

Every numeric claim in §3 checked on 2026-08-22 was wrong: `api.ts` 529/61 →
**864/97**; `MatchesView.vue` 508 → 560; `match-trends-helpers.ts` 519 → 623;
`pkg/app` 47 files/5,673 LOC → 50/6,480; `*_alias.go` 358 LOC → 445; 41
`app.Err*` sentinels → 43; `App.vue` 177 → 189; `useMatchesNarrow.test.ts` 845 →
1189; `MatchesView.test.ts` 605 → 945; both bundle budget pairs two generations
stale; `match-dossier-aggregate.ts` had moved to `src/match/dossier/`.

This is precisely the failure the standards name — *"prose restatements
drift"* — which is why coverage floors and package budgets were moved **into the
gates**. §3 is prose restating measurements, so it rots identically. The
Package-size rule already records this exact incident once: *"`TECHNICAL_DEBT.md`
recorded per-file growth triggers that three files then passed unnoticed."* It
has now happened a second time, which makes it a pattern rather than a lapse.

**Still owed:**

1. **Split or re-argue `api.ts`** at its true size (864 lines / 97 wrappers).
   §3 no longer accepts it; the file has section comments already marking the
   split lines. **Effort: S.**
2. **Decide the twelve unlisted 500+ files** catalogued in §3 — in particular
   the four Go files and `stores/coach.ts`, which have never been argued either
   way, and `MatchMapRoleBand.vue`, which was paid down to 493 and has since
   regrown to 504. **Effort: M.**
3. **Stale pointers.** `pkg/app/correlation.go` and `pkg/app/probe_test.go`
   **do not exist** — both left in the `pkg/correlate` carve — and are still
   cited by `parser/screenshot_sources.go`, `screenshot_sources_test.go` and
   `cmd/server_test.go`. (`.claude/rules/app-shell.md` cited `correlation.go`
   too and was corrected alongside this section: a standard misdescribing the
   layout it governs, auto-loaded for anyone touching `pkg/app/**`, was the one
   pointer worth fixing in the same breath as recording it.) **Effort: S.**
4. **`db.CoachStore`'s doc comment is false.** It claims *"the coach package
   depends on ONE consumer-side seam."* It does not: `pkg/coach` declares its
   own `NoteStore` and `pkg/coachreturn` its own `Store`, and the only reference
   to `db.CoachStore` anywhere is its embedding one line away in `db.Store`.
   **Effort: S.**
5. **`SettingsView.test.ts` has 15 cases named `it('emits …')`** against a
   component with **zero** `defineEmits`, via a `renderSettings({ props: … })`
   harness that seeds Pinia and passes no props. The tests are correct; their
   names send every reader hunting for emits that do not exist. **Effort: S.**

**Prevention, not just repair:** the durable fix for the numbers is to stop
restating measurements in prose. Where a gate exists, cite the gate
(`scripts/ci/check-bundle-size.sh`, `package-size-budgets.txt`,
`GO_COVERAGE_MIN`). Where none exists, cite the symbol and let the reader
measure. Line-number citations are now absent from this file entirely — §5 held
the last one, and it had rotted from 250 to ~400 inside a single release.

## 19. Dead weight

**Priority: LOW. Effort: S.** Three clusters, each with no mechanical gate that
would ever find them.

- **Seven `export_test.go` re-exports with zero callers** —
  `ValidateMatchesQueryParams`, `ProblemStatus`, `ProblemSlug`,
  `PathIsMissingOrNotADir`, `SetStore`, `ExportSchema`, `Crop`. `unused` does
  not reach test-file exports and `dead-code-go` skips test code, so this class
  has **no gate at all**. Two carry doc comments asserting a need that no longer
  exists.
- **A "Phase 1" compat shim whose follow-up never landed** — `LEGACY_DATA_KPI` /
  `LEGACY_DATA_BREAKDOWN` (`useDashboardGrid.ts`), three of whose four entries
  are identity mappings, costing two exported symbols, two props on a shared
  component, and two DOM attributes on every widget. Deleting it means
  re-pointing nine Playwright locators. The standards call this out by name:
  *"no backwards-compat shims for undeployed code."*
- **Five `shared/` files read by exactly one feature** — `useMatchClock` (5
  importers, all under `components/matches/`), `useGlobalKeyboard` (1),
  `useEventStream` (1), `CommandPalette.vue` (1), `useSummaryThumbnail` (1). The
  frontend rule names this mechanism explicitly: *"that is how both `shared/`
  folders became junk drawers the first time."* Moving them re-ratchets
  directory budgets in the same commit, so pair the two.

## 20. 29 of 123 directories sit at their size ceiling

**Priority: MED. Effort: a decision, not a patch.** Zero-headroom is deliberate
and correct — it is what makes the gate trip on the *first* file past the line.
But a quarter of the tree sitting *at* the line means most future changes open a
budget conversation before they open a code review, and the two legitimate
answers (split vs. bump) are not interchangeable.

Some of the 29 are genuine split candidates; others are budgets that were set at
the directory's count rather than at its responsibility, which is the failure
mode the rule warns about from the other direction. Telling them apart is a
directory-by-directory judgment call. **Schedule it as its own pass** — treating
it as a patch is how a folder silently regrows what it just shed.

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
