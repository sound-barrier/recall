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

Findings from a Go / Vue / TypeScript / Python audit (2026-06-12) against the
**Design principles**, **Code style**, **Working style**, **TDD process**, and
**What to avoid** sections of `CLAUDE.md`. Backwards compatibility is a non-goal,
so items may propose breaking API / SQLite-schema / on-disk changes without
migrating users. Measured with `gocyclo`, `wc -l`, `make cover`, and grep sweeps;
re-measure before paying an item down (numbers drift).

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

---

## Out of scope — deliberately not building

- **In-app auto-updater** (was F3) — Wails v2 does not support an in-app binary updater, so the masthead flow stays "Check for updates → Open release page." Parked; revisit later if the updater story changes.
- **Real desktop-runtime e2e for Wails** (was D4) — the `EventsOn`/`EventsOff` bridge, native dialogs, and watcher are only exercised on the released desktop app; a `wails dev` + CDP driver is cross-platform-fragile. Not worth the harness today. Parked; revisit later if an EventsOn / file-watcher / native-dialog regression actually bites.
- **Analysis / coaching-insight dashboard tab** — the dev-only Analysis tab and its `MatchesDashboardSketch` were removed; the coaching-cards direction is not being pursued. Per-hero/per-session insight ideas, if they ever return, surface inside the Matches dossier, not a separate tab. (Speculative insight ideas remain parked in `FEATURES.md`.)
- **Drag-to-reorder leaf rows** — matches are immutable history ordered by `parsed_at` / `finished_at`; reordering would lie about when they happened.
- **Match comparison side-by-side view** — the detail panel is single-match. If comparison ever earns its way back, it's "tabs inside the panel", not dual inline expansion.
- **Match deletion confirmation modal** — the two-click confirm-then-act pattern in `MatchCardDanger.vue` is already correct UX.
