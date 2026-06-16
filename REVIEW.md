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
> contract and activates the migration framework (`pkg/db/migrate.go`). The REST
> contract and 3NF schema audits found no outstanding debt; the remaining
> code-quality items (Q13, Q17) are polish that can land before or after, and
> activating the migration framework (Q18) is the deliberate 1.0-cutover
> follow-up.

### Q11. DRY/complexity hotspots to watch (do not over-abstract)

**Where:** the four near-identical `register*Routes` (`pkg/cmd/server_*.go`) and
the export/import bundle cluster (`ExportBundle` / `importJSONv1` /
`importDataCSV` / `ValidateBundle`).

**What:** these are the densest duplication+complexity clusters. Worth a
rule-of-three look once Q1 decomposes them — but YAGNI applies: prefer a couple of
extracted helpers over a speculative framework. Tracking note, not a mandate.

**Size:** M. **Risk:** Low.

### Q13. App.vue shell — partial extraction done; remaining wiring noted

Three cohesive state clusters were pulled out of `App.vue` into composables
(2413 → **2221**): `useCardFocus` (the j/k/gg/G/n/N card-focus walk),
`useIgnoredScreenshots` (the suppress-list panel + restore/clear/re-parse), and
`useExportBundle` (bundle + flat-CSV export). Tesseract status + the
update-reminder were already composables.

App.vue still carries parse run-state, profile/tour/first-run wiring, and the
right-click + resolve/ignore flows — each a candidate for the same treatment, but
they're more entangled with the shell's load/error/nav functions. Continued
direction, not a blocker; the shell shrinks one composable per commit.

**Size:** L (partial). **Risk:** Med — App.vue owns a lot of shared state; stage
one composable per commit.

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

## Out of scope — deliberately not building

- **In-app auto-updater** (was F3) — Wails v2 does not support an in-app binary updater, so the masthead flow stays "Check for updates → Open release page." Parked; revisit later if the updater story changes.
- **Real desktop-runtime e2e for Wails** (was D4) — the `EventsOn`/`EventsOff` bridge, native dialogs, and watcher are only exercised on the released desktop app; a `wails dev` + CDP driver is cross-platform-fragile. Not worth the harness today. Parked; revisit later if an EventsOn / file-watcher / native-dialog regression actually bites.
- **Analysis / coaching-insight dashboard tab** — the dev-only Analysis tab and its `MatchesDashboardSketch` were removed; the coaching-cards direction is not being pursued. Per-hero/per-session insight ideas, if they ever return, surface inside the Matches dossier, not a separate tab. (Speculative insight ideas remain parked in `FEATURES.md`.)
- **Drag-to-reorder leaf rows** — matches are immutable history ordered by `parsed_at` / `finished_at`; reordering would lie about when they happened.
- **Match comparison side-by-side view** — the detail panel is single-match. If comparison ever earns its way back, it's "tabs inside the panel", not dual inline expansion.
- **Match deletion confirmation modal** — the two-click confirm-then-act pattern in `MatchCardDanger.vue` is already correct UX.
