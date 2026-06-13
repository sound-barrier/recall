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

### Q1. Go production functions blow past the ~25-line / ≤10-complexity ceiling

**Where:** every non-test function over 60 LOC (McCabe in parens where >15):

| Function | LOC | McCabe | File |
|---|---:|---:|---|
| `GenerateMatchFixture` | 402 | 45 | `pkg/app/fixtures.go` |
| `(*App).runClaimedParse` | 145 | — | `pkg/app/parse.go` |
| `ValidateBundle` | 145 | 31 | `pkg/app/bundle_validate.go` |
| `(*App).Startup` | 129 | — | `pkg/app/app.go` |
| `ensureCoverage` | 126 | 23 | `pkg/app/fixtures.go` |
| `(*App).CheckForUpdate` | 119 | — | `pkg/app/update.go` |
| `(*App).ScreenshotHandler` | 102 | 19 | `pkg/app/screenshot_handler.go` |

Additionally over the complexity-15 line but shorter: `matchByEAD` (28,
`pkg/app/correlation.go`), `pickHero` (23, `fixtures.go`), `findStatColumns` (20,
`pkg/parser/parse_teams.go`), `aggregateMatchKey` (18, `pkg/app/aggregate.go`).

**What:** each does more than "one thing in a single clause." Two shapes: the
`register*Routes` group is route wiring with inline handler closures (extract one
named handler per route, or accept it as flat wiring); the rest — `MoveMatches`,
`ValidateBundle`, `import*`, `ExportBundle`, `Startup`, `CheckForUpdate` — are
genuine multi-step logic to decompose. These are the live entries behind
`docs/baselines/complexity-baseline.txt` (which says to track them here).

**Size:** L. **Risk:** Low — pure refactors with existing test coverage.

---

### Q2. Oversized Vue SFCs (16 components over 500 lines)

**Where:**

| Component | Lines | Note |
|---|---:|---|
| `MatchCardExpanded.vue` | 2858 | 478 script (25 fns/computeds inline) / 736 template / 1639 scoped CSS |
| `UnknownMapsView.vue` | 1458 | view |
| `NarrowPopover.vue` | 1332 | filter rail |
| `MatchesView.vue` | 1100 | workspace shell (extraction already in progress) |
| `MatchHeroModeBand.vue` | 842 | dossier band |
| `MatchesMembersList.vue` | 747 | |
| `UpdateCheckModal.vue` | 719 | |
| `MatchDetailPanel.vue` | 655 | |
| `SettingsAdvanced.vue` | 638 | |
| `ProfileSwitcher.vue` | 636 | |
| `TourCallout.vue` | 612 | |
| `IgnoredFilesPanel.vue` | 606 | |
| `MatchMapRoleBand.vue` | 591 | |
| `MatchesArchiveDrawer.vue` | 591 | |
| `MatchesDossierHead.vue` | 562 | |
| `SettingsView.vue` | 551 | |

**What:** violates SRP and "stateful logic goes in a composable, not an SFC's
`<script setup>`." `MatchCardExpanded.vue` is the standout — its 478-line script
with 25 functions/computeds belongs in composables, its 736-line template wants
sub-components, and 1639 lines of scoped CSS is its own smell. Several others are
mostly markup+CSS (lower priority); triage logic-heavy scripts first.

**Size:** XL (spread across 16). **Risk:** Low — component/composable extraction
is local, guarded by the SFC + e2e suites.

---

### Q3. Large TypeScript composables (>400 lines)

**Where:** `useMatchesDossier.ts` (1198), `useMatchesNarrow.ts` (525),
`useDashboardLayout.ts` (477), `useOnboardingTour.ts` (461) — all in
`frontend/src/composables/`.

**What:** `useMatchesDossier` mixes the bedrock-refs tier and the parameterized
query-helper tier in one file (1198 lines) — split along that existing seam. The
others are single-concern but dense; lower priority.

**Size:** M. **Risk:** Low.

---

### Q4. Large Go files (file-per-concern is drifting)

**Where:** `pkg/app/fixtures.go` (1277), `pkg/app/export_csv.go` (781),
`pkg/db/dbtest/fake.go` (727), `pkg/app/correlation.go` (665),
`pkg/app/update.go` (653), `pkg/app/aggregate.go` (525).

**What:** several hold multiple concerns (e.g. `fixtures.go` = generation +
coverage-balancing + image writing + colour math). Split per concern.

**Size:** M. **Risk:** Low.

---

### Q5. Go tests are 100% white-box and reach into unexported internals

**Where:** all 84 `pkg/**/*_test.go` files declare `package <pkg>` (0 use the
`<pkg>_test` black-box form); 47 call unexported identifiers directly — e.g.
`aggregate_test.go` → `aggregateScreenshots`, `correlation_test.go` →
`matchByEAD`.

**What:** contradicts "Test public interfaces, not internals … do not write tests
that reach into unexported helpers." Where behaviour is observable through an
exported surface (e.g. aggregation via `GetMatchResults`), prefer a `_test`
package driving that surface; reserve white-box for genuinely-pure internal
primitives. (Nuance: white-box is idiomatic Go for some cases — this is a
direction, not a blanket rewrite.)

**Size:** L. **Risk:** Med — touches every test file; stage to avoid coverage loss.

---

### Q6. Coverage margins are thin; a few units sit below the 60% floor

**Where:** `make cover` (2026-06-12): Go **65.9%** stmt (floor 60); frontend
**68.62%** stmt / **71.6%** line / **62.92%** branch / **62.38%** func (floors
60/60). Below floor individually: `frontend/src/composables/useTesseractStatus.ts`
(57% line), `frontend/src/test-utils/mountApp.ts` (42% func — test util),
`pkg/app/app_wails.go` (0% — Wails-tag-gated, see the parked desktop-e2e item).

**What:** the umbrella passes but branch coverage (62.92%) and Go (65.9%) have
little headroom; CLAUDE.md asks for "higher where consequential" (parser,
aggregation, error paths). Add targeted tests for the below-floor production units.

**Size:** M. **Risk:** Low.

---

### Q7. Swallowed errors on operations that can meaningfully fail

**Where:** `_ = a.saveSettings(a.settings)` at `pkg/app/probe.go:358`,
`app.go:256`, `app.go:266`, `profile_app.go:142`, `profile_app.go:213`,
`profile_app.go:233`, `profile_app.go:237`; `_ = a.reopenActiveStore()`
(`profile_app.go:157`); `_ = parser.Reload()` (`parser_dir.go:21`);
`_ = TouchLastChecked(now)` (`update.go:223`).

**What:** "never swallow errors silently." A failed `saveSettings` (disk full,
perms) or `reopenActiveStore` leaves the app in a silently-wrong state. Surface or
at least `slog.Warn` them. (The `os.Remove`/`os.WriteFile` ignores in
`restoreSnapshot`/`removeTmpFiles`, `apply_data_update.go`, are best-effort
rollback/cleanup and are fine — exclude those.)

**Size:** M. **Risk:** Low–Med — surfacing a previously-ignored error can change
flow; add a test per site.

---

### Q8. Speculative dead value kept "for a future debug log"

**Where:** `pkg/app/parse.go:375` — `_ = inserts // value is reserved for a future
debug log; suppress unused`.

**What:** a computed value discarded for a hypothetical future use — exactly the
"YAGNI / no just-in-case code" line. Delete `inserts` (and its computation if
otherwise unused) until the debug log actually exists.

**Size:** S. **Risk:** Low.

---

### Q9. Invariant `panic` for post-Startup nil wiring

**Where:** `pkg/app/app.go:326`, `app.go:329` — `panic("App.Startup: … is nil
after Startup completed …")`.

**What:** borderline against "no error handling for impossible conditions." These
are fail-fast guards for a refactor breaking internal wiring; defensible, but
consider whether the `captureFatal`/`StartupError()` path already covers it,
making the panics redundant. Low priority — listed for completeness.

**Size:** S. **Risk:** Low.

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
