# Review — outstanding work

The single backlog for Recall: everything we still want to do
(features, bugs, tech debt, polish) plus the things we've deliberately
decided **not** to build. Consolidates the former `TECHNICAL_DEBT.md`,
`UI_RECOMMENDATIONS.md`, `1-0-RELEASE-PLAN.md`, `1-0-FOLLOWUPS.md`, and
`ROADMAP.md` — all drained to the live items below; shipped history
lives in git.

Speculative, uncommitted feature *ideas* live separately in
`FEATURES.md` (its own Triaging → Accepted → Shipped workflow). An idea
graduates into this file when it's actually slated for work.

Record new items the same week you find them. When an item ships or is
paid down, **delete** its section — no strikethrough, no "✅", just
delete it; git history is the audit trail. Ids stay stable (gaps are
fine; never renumber).

## Effort tags

Each item carries **size** (coding effort + review surface) and **risk**
(what could break) so triage favours low-cost, low-blast-radius first.

| Size | Rough effort |
|---|---|
| **S** | < 2 hours — a single-file change, one config flip. |
| **M** | ½–2 days — a refactor inside one package/view; new test file. |
| **L** | 2–5 days — multi-package refactor; new abstraction. |
| **XL** | 1–2 weeks — reshaping a whole layer; new runtime dependency. |

| Risk | What "breaks" means |
|---|---|
| **Low** | Local; a slip is a small diff that lint/test catch. |
| **Med** | Touches multiple layers or a shared abstraction; stage carefully. |
| **High** | SQLite schema, on-disk format, public URL shape, or build-tag-conditioned behaviour — mistakes can corrupt user data or strand installs. |

---

## Code quality (CLAUDE.md principle audit)

Findings from a Go / Vue / TypeScript / Python audit (2026-06-12, refreshed by a
**pre-1.0.0 pass on 2026-06-16**) against the **Design principles**, **Code
style**, **Working style**, **TDD process**, and **What to avoid** sections of
`CLAUDE.md`, plus a REST review against `.claude/rules/api-design.md` and a 3NF
review against `.claude/rules/database.md`. Backwards compatibility is a non-goal,
so items may propose breaking API / SQLite-schema / on-disk changes without
migrating users — the 1.0 cut is the deliberate freeze point. Measured with
`gocyclo`, `wc -l`, `task cover`, and grep sweeps; re-measure before paying an
item down (numbers drift).

> **2026-06-16 pre-1.0 framing.** 1.0 freezes the HTTP API + SQLite-schema
> contract and activates the migration framework (`pkg/db/migrate.go`). The one
> contract item (Q12, the queue-route rename) is worth landing *before* the
> freeze; the code-quality items (Q13–Q17) are polish that can land before or
> after. Activating the migration framework itself is a separate follow-up
> (Q18), deliberately out of scope for the contract-fix PRs. The DB schema needs
> no contract fix — it's already 3NF-clean (see below).

### REST API contract (`api/openapi.yaml`, `pkg/cmd/server*.go`)

Walked all ~45 operations against `.claude/rules/api-design.md`. The surface is
healthy overall — noun resources, correct verb→intent, the 200/201/202/204/4xx
table is honoured, params are snake_case, response arrays use `make([]T, 0)`, the
`_fetch` 204/202 handling is consistent, and diagnostic-only ops carry
`x-internal: true` (`/profiles/test/seed`, `/system/screenshots-folder-candidates/stats`,
`/system/tesseract-probe`). One real inconsistency:

### Q12. `queue` vs `queue-type` URL-segment asymmetry for the same concept-pair

**Where:** `api/openapi.yaml` — per-match `PUT/DELETE /api/v1/matches/{match_key}/queue`
(`SetMatchQueue`/`ClearMatchQueue`) vs bulk `PUT /api/v1/matches/queue-type`
(`BulkSetMatchQueue`).

**What:** the play-mode pair uses the **same** segment for both scopes
(`/matches/{match_key}/play-mode` + `/matches/play-mode`), but the queue pair
splits: per-match `/queue` vs bulk `/queue-type`. Same concept, two names — a
papercut that becomes a permanent inconsistency once the URL contract freezes at
1.0. **Fix:** rename the bulk route to `PUT /api/v1/matches/queue` so both queue
routes and the play-mode template all match; update `pkg/cmd/server*.go`, the
`api.ts` wrapper, `api.gen.d.ts`, and the spec together. Pure rename, no
behaviour change.

**Size:** S. **Risk:** High — public URL shape; must land before the 1.0 freeze.

### DB schema / 3NF (`pkg/db/schema.sql`)

Audited all parent + child + override + aux tables against
`.claude/rules/database.md`. **No 3NF or naming debt found** — derived `role`/`type`
are correctly computed at read time (never stored), repeating groups are split
into child tables with composite PKs, FK actions are deliberate (RESTRICT on
`screenshots_dir_id`, CASCADE on children), timestamps are `*_at`, CHECK
constraints guard enums, and the `user_match_data` NULL-means-OCR contract is
sound. The two apparent "duplications" are intentional and documented: the
per-screenshot `teams_screenshots.queue_type` (OCR-inferred) vs the `match_queue`
override table, and the wide `user_match_data` override layer mirroring parent
scalars. Recorded as healthy below; no fix.

### Q2. Oversized Vue SFCs — best-effort decomposition (two dense shells remain)

The 16 oversized SFCs were decomposed against the best-effort <600-line bar
(documented in `CLAUDE.md` → Code style → File length): the flagship
`MatchCardExpanded.vue` went 2858 → 487 (seven child SFCs + `useMatchAnnotationEditor`),
and 13 others now sit under 600 via extracted composables / sub-components
(`MatchHeroModeBand`, `MatchesMembersList`/`MatchesTable`, `UpdateCheckModal`,
the Settings/Profile/Tour/IgnoredFiles/MatchDetail trims, the dashboard bands,
etc.). `MatchesView.vue` (workspace shell) landed at ~700.

**Kept (best-effort), with rationale:** `NarrowPopover.vue` (~1177) and
`UnknownMapsView.vue` (~1411) are orchestration shells that already delegate to
several child SFCs; their residue is ~580 lines of *uniform* filter-dimension /
triage-card sections sharing one scoped-CSS base + cross-coupled state. Forcing
them under 600 would mean fragmenting into many per-section sub-components and
moving shared scoped CSS global — artificial fragmentation + risk for a
line-count win, against the YAGNI / "three similar lines beat one abstract one"
rule. The clean wins were taken (`NarrowPresets` extracted; `useHoverThumbnail`
shared); further splitting is deliberately deferred.

**Size:** XL (done). **Risk:** Low — every extraction was a pure move guarded by
the SFC + e2e suites.

**2026-06-16 refresh.** Re-measured (`wc -l src/**/*.vue`): the kept shells held
(`UnknownMapsView` 1411, `NarrowPopover` 1214), but the pivot / manual-match /
status-chooser features pushed a cluster back over the ~600 best-effort bar —
`MatchesView` 733, `ManualMatchModal` 719, `MatchStatusChoosers` 712,
`MatchDetailPanel` 704, `MatchJournal` 626, `MatchesMembersList` 623. These are
the same orchestration-shell shape Q2 already accepts; flagged here only so the
trend is visible. `App.vue` (now 2413) is tracked separately as Q13.

---

### Q5. Go tests are all black-box (`<pkg>_test`) — done

Every `pkg/**/*_test.go` file that contains tests now declares `package
<pkg>_test`; none reaches into unexported identifiers directly. Verified:
`find pkg -name '*_test.go'` with a `Test`/`Benchmark`/`Fuzz`/`Example` func and a
non-`_test` package returns nothing.

Where behaviour is observable through the public surface the tests drive it
directly (the HTTP routes via `NewMux`, the store CRUD via the `Store` interface,
aggregation via `GetMatchResults`, the data-dir reload via `SetDataDirFunc` +
`Reload`, App settings via the public setters). Where it is not — the correlation
/ aggregation / inference engine, the OCR primitives, the security middleware, the
update client, the fixture generator, settings IO — a **test-only `export_test.go`
bridge** (one per package; `bridge_test.go` in `pkg/app`) re-exports exactly the
internals the suites need: value aliases for funcs, method expressions for
unexported `*App` methods, pointer accessors for unexported fields, pointer seams
for swapped vars (`releasesURL`, `renameFunc`, `maxZipEntryBytes`, …), and
constructors for unexported types (`screenshotView`, the SSE envelope). These
bridges hold no tests and are compiled only under `go test`, so they widen no
shipped API.

No tests were deleted and no production API changed. Coverage held per package
(db 62.2 %, cmd 70.7 %, app 76.6 %, parser 60.3 %, metrics/applog unchanged); the
60 % aggregate floor is unaffected.

**Size:** L (done). **Risk:** Med — every flip was guarded by the unchanged green
suite.

---

### Q11. DRY/complexity hotspots to watch (do not over-abstract)

**Where:** the four near-identical `register*Routes` (`pkg/cmd/server_*.go`) and
the export/import bundle cluster (`ExportBundle` / `importJSONv1` /
`importDataCSV` / `ValidateBundle`).

**What:** these are the densest duplication+complexity clusters. Worth a
rule-of-three look once Q1 decomposes them — but YAGNI applies: prefer a couple of
extracted helpers over a speculative framework. Tracking note, not a mandate.

**Size:** M. **Risk:** Low.

---

### Q13. `App.vue` is a 2413-line shell — extract cross-cutting state

**Where:** `frontend/src/App.vue` (2413 lines — the largest hand-written file in
the tree after the generated `api.gen.d.ts`).

**What:** it's the documented router-shell (masthead + four lazy views + modals +
cross-cutting state), and the keyboard registry already moved out to
`useGlobalKeyboard`. But it still carries several independent state concerns
inline — parse run-state, Tesseract status + pickers, the System-Alert gate,
settings wiring, card-focus + selection, the update-check flow — each of which is
a composable-shaped unit. Past the ~500-line ceiling by ~5×; the cleanest wins
are pulling the Tesseract/settings and parse-status clusters into
`useTesseractStatus` / `useParseRunState`-style composables and letting App.vue
stay pure wiring. **Fix:** extract 2–3 cohesive state composables (mirroring the
existing `useGlobalKeyboard` extraction); each move is guarded by the App + e2e
suites.

**Size:** L. **Risk:** Med — App.vue owns a lot of shared state; stage one
composable per commit.

### Q14. `components/matches/` is a 65-file flat feature dir

**Where:** `frontend/src/components/matches/` — 65 files (`ls`), far past the
~20–25 the `CLAUDE.md` *Package & directory size* rule flags for sub-grouping.

**What:** the feature-folder regroup (Q-era #375–378) put every match component
in one folder; the pivot, dossier, detail-panel, status-chooser, list, and
archive clusters have since grown it to 65. It's one *feature* but several
*sub-domains*. **Fix:** sub-group into `matches/{list,detail,dossier,pivot,status,archive}/`
(+ a `matches/shared/` for the cross-cluster pieces), mirroring the
`dashboard/widgets/` nesting. Pure moves — the `@/` alias means no import in the
moved files changes; only the importers' paths update.

**Size:** M. **Risk:** Low — location-independent `@/` imports + green SFC/e2e
suites make this a mechanical move.

### Q15. Go production functions over the gocyclo-15 refactor line

**Where:** `gocyclo -over 15` (production, non-test, excluding parser/`tmp`):
`UpsertUserMatchData` (18, `pkg/db/store_usermatch.go:12`), `MergeMatchResult`
(17, `pkg/correlate/correlation_merge.go:31`), `FoldGroup` (17,
`pkg/aggregate/aggregate.go:153`), `ReAggregateUnknowns` (16,
`pkg/db/store_reaggregate.go:27`), `MatchByTimestampWindow` (16,
`pkg/correlate/correlation.go:312`), `SeedProfile` (16) + `writeFixture` (21,
`pkg/app/seed.go`).

**What:** `CLAUDE.md` aspires to ≤10 and calls **>15 a refactor candidate**. The
read/write/correlation hot paths (`UpsertUserMatchData`, `MergeMatchResult`,
`FoldGroup`, `ReAggregateUnknowns`, `MatchByTimestampWindow`) are the ones worth
extracting sub-steps from — each folds several distinct concerns into one
function. The `seed.go` pair is dev-onboarding support (lower stakes). Parser
density (`parsePersonalStatCell` 17) stays exempt per the rule. **Fix:** extract
named sub-steps (no behaviour change), guarded by the existing store/aggregate/
correlate suites.

**Size:** M. **Risk:** Low — pure extraction under green unit tests.

### Q16. Two Go files just over the 500-line soft ceiling

**Where:** `pkg/db/store.go` (534), `pkg/app/parse.go` (501).

**What:** both marginally past the `CLAUDE.md` ~500-line file ceiling. `store.go`
can shed the per-type row loaders into the existing `store_<type>.go` siblings;
`parse.go` is a dense single-concern pipeline (closer to the irreducible end).
Best-effort, not a gate — listed for completeness.

**Size:** S. **Risk:** Low.

### Q17. Coverage sits right on the floor

**Where:** `task cover` (2026-06-16): Go **67.4%** vs `GO_COVERAGE_MIN` 67;
frontend **61.45% branch / 60.0% functions** vs the 60 `vitest.config.ts` floor.

**What:** both meet the floor but with razor-thin margin — a single deletion of a
covered path can dip Go under 67. The `CLAUDE.md` floor is "a minimum, not a
target — aim higher where the code is consequential (parser logic, aggregation,
error paths)." For a 1.0 baseline, lift the consequential gaps (parser error
branches, the aggregate folds, the new pivot / CSV-export helpers, `tesseract.go`
`ocrThreshold` at 0%) so the headroom isn't one commit deep. Not a violation — a
raise-the-bar item.

**Size:** M. **Risk:** Low.

### Q18. Activate the migration framework at 1.0 (separate follow-up)

**Where:** `pkg/db/migrate.go` (scaffolded, inert) + empty `pkg/db/migrations/`.

**What:** pre-1.0 the schema is "wipe + relaunch"; `applyMigrations` is a no-op.
1.0 is the point the scaffold was built for: seed the baseline (current
`schema.sql` as `0001_init.up.sql`/`.down.sql`), flip the runner live, and switch
the *Adding a field* workflow to versioned migrations. **Deliberately out of
scope** for the contract-fix PRs (per the pre-1.0 decision) — recorded here as the
1.0 cutover task so it isn't lost. Land it *with or just after* the 1.0 tag, once
the contract-breaking items (Q12) have settled the final schema shape.

**Size:** M. **Risk:** High — on-disk schema management; get the baseline exactly
matching the shipped `schema.sql` or existing installs mis-migrate.

---

## Healthy — principles already followed

Recorded so the audit isn't misleadingly negative; do **not** "fix" these.

- **Interface discipline / YAGNI** — exactly one production interface
  (`pkg/db/store.go` `Store`, the sanctioned DI seam); one-method dependencies use
  function-variable seams (`runTesseractFunc`, `parseSingleFunc`). No speculative
  interfaces or abstract layers without a second caller.
- **Type safety** — effectively zero `any` (one justified case at the Wails bridge,
  `frontend/src/api.ts:38`); types narrowed at boundaries.
- **No SQL injection** — every query is parameterized; zero `Sprintf`-built SQL.
- **Path-traversal defense-in-depth** — `ScreenshotHandler`
  (`pkg/app/screenshot_handler.go`) rejects non-basenames AND re-checks
  containment via `filepath.Abs` + `HasPrefix`, is `#nosec`-annotated with the
  rationale, and is pinned by `FuzzScreenshotHandler_URL`.
- **Pure-Go constraint** held (no CGo); **lint coverage** now spans every language
  (#330); the **complexity-baseline** observability tooling already exists.
- **REST contract** — all ~45 `api/openapi.yaml` operations follow
  `.claude/rules/api-design.md`: noun resources, correct verb→intent, the
  200/201/202/204/4xx table, snake_case params, `make([]T, 0)` response arrays,
  the `_fetch` 204/202 handling, and `x-internal: true` on the three diagnostic
  ops. Only the queue/queue-type segment rename (Q12) is outstanding.
- **DB schema is 3NF-clean** — derived `role`/`type` computed at read time (never
  stored), repeating groups split into child tables with composite PKs,
  deliberate FK actions (RESTRICT/CASCADE), `*_at` timestamps, CHECK-guarded
  enums, and a sound NULL-means-OCR `user_match_data` override contract. The two
  apparent duplications (`teams_screenshots.queue_type` vs `match_queue`; the wide
  `user_match_data` layer) are intentional and documented in
  `.claude/rules/database.md`.

---

## Out of scope — deliberately not building

- **In-app auto-updater** (was F3) — Wails v2 does not support an in-app binary updater, so the masthead flow stays "Check for updates → Open release page." Parked; revisit later if the updater story changes.
- **Real desktop-runtime e2e for Wails** (was D4) — the `EventsOn`/`EventsOff` bridge, native dialogs, and watcher are only exercised on the released desktop app; a `wails dev` + CDP driver is cross-platform-fragile. Not worth the harness today. Parked; revisit later if an EventsOn / file-watcher / native-dialog regression actually bites.
- **Analysis / coaching-insight dashboard tab** — the dev-only Analysis tab and its `MatchesDashboardSketch` were removed; the coaching-cards direction is not being pursued. Per-hero/per-session insight ideas, if they ever return, surface inside the Matches dossier, not a separate tab. (Speculative insight ideas remain parked in `FEATURES.md`.)
- **Drag-to-reorder leaf rows** — matches are immutable history ordered by `parsed_at` / `finished_at`; reordering would lie about when they happened.
- **Match comparison side-by-side view** — the detail panel is single-match. If comparison ever earns its way back, it's "tabs inside the panel", not dual inline expansion.
- **Match deletion confirmation modal** — the two-click confirm-then-act pattern in `MatchCardDanger.vue` is already correct UX.
