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
> contract item (the queue-route rename) has been paid down before the freeze;
> the code-quality items (Q13–Q17) are polish that can land before or after.
> Activating the migration framework itself is a separate follow-up (Q18),
> deliberately out of scope for the contract-fix PRs. The DB schema needs no
> contract fix — it's already 3NF-clean (see below).

### REST API contract (`api/openapi.yaml`, `pkg/cmd/server*.go`)

Walked all ~45 operations against `.claude/rules/api-design.md`. The surface is
healthy overall — noun resources, correct verb→intent, the 200/201/202/204/4xx
table is honoured, params are snake_case, response arrays use `make([]T, 0)`, the
`_fetch` 204/202 handling is consistent, and diagnostic-only ops carry
`x-internal: true` (`/profiles/test/seed`, `/system/screenshots-folder-candidates/stats`,
`/system/tesseract-probe`). The one inconsistency the audit found — the bulk queue
route's `queue-type` segment vs the per-match `/queue` and the play-mode template
— was paid down before the freeze (bulk renamed to `PUT /api/v1/matches/queue`).
No outstanding REST-contract debt.

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

### Q15. Go complexity — engine hot paths done; dev-support residual acceptable

The five read/write/correlation hot paths flagged here were extracted into named
sub-steps (all now ≤10, pure refactors under the green store/aggregate/correlate
suites): `UpsertUserMatchData` 18→8, `FoldGroup` 17→8, `MergeMatchResult` 17→2,
`ReAggregateUnknowns` 16→6 (also de-duplicated the hero/map promote blocks), and
`MatchByTimestampWindow` 16→9.

The remaining `gocyclo>15` are left as-is **by design**: `writeFixture` (21) /
`SeedProfile` (16) in `pkg/app/seed.go` and `pickHeroConstrained` (18) /
`applyChaosShape` (17) in `pkg/fixtures/` are dev-seed support (off the
user-facing path), and `parsePersonalStatCell` (17) is the dense parser logic
`CLAUDE.md` explicitly exempts. Revisit only if they grow further.

**Size:** M (engine paths done). **Risk:** Low.

### Q16. Go file sizes — store.go split; parse.go is 1-line-over noise

`store.go` (534) carried the `Store` interface + `SQLStore` impl **plus** ~270
lines of row/state structs; the data-model types moved to `store_types.go` and
store.go is now 265. `parse.go` (501) is one line past the ~500 soft ceiling — a
dense single-concern pipeline at the irreducible end, left as-is (the ceiling is
best-effort, not a gate).

**Size:** S (done). **Risk:** Low.

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
the schema shape is final.

**Size:** M. **Risk:** High — on-disk schema management; get the baseline exactly
matching the shipped `schema.sql` or existing installs mis-migrate.

---

### Q19. Integration (e2e) coverage never reaches the PR comment

**Where:** the `pr-report` job in `.github/workflows/ci.yml` vs the
`go-e2e-coverage` / `frontend-e2e-coverage` artifacts produced by
`.github/workflows/e2e.yml`.

**What:** the combined PR comment's *Integration (e2e)* column reads "—
pending" on **every** PR — verified on a code PR (#406) whose branch *did* have
both e2e-coverage artifacts uploaded. Root cause is a parallel-workflow race:
`pr-report` lives in `ci.yml` and renders the comment after only `ci.yml`'s
coverage/lint jobs (~3–5 min), while the e2e coverage is produced by the separate
`e2e.yml` run (~8–13 min, Playwright). At render time the current commit's e2e
artifact doesn't exist yet, the cross-workflow `dawidd6` download (keyed on
`branch`, defaulting to *successful* runs) finds nothing, and `pr-report` is never
re-triggered when `e2e.yml` later finishes — so the column stays "pending" for the
life of the commit. The renderer + artifact paths are correct; only the timing is.

**Fix:** render the sticky comment from a workflow triggered
`on: workflow_run: [CI, E2E] completed` instead of inline in `ci.yml`. By the time
that job runs both workflows' artifacts exist for the head SHA; it downloads them
(keyed on `commit`, not just `branch`) and updates the one comment. Removes the
race entirely; the renderer (`scripts/ci/render-pr-report.py`) is unchanged.

**Size:** S. **Risk:** Low — CI-only; `workflow_run` triggers run from the default
branch so the fix can only be validated on PRs *after* it merges (note in the PR).

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
  ops. The one segment-naming inconsistency (bulk queue route) was paid down
  before the 1.0 freeze.
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
