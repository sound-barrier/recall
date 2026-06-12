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

## Out of scope — deliberately not building

- **In-app auto-updater** (was F3) — Wails v2 does not support an in-app binary updater, so the masthead flow stays "Check for updates → Open release page." Parked; revisit later if the updater story changes.
- **Real desktop-runtime e2e for Wails** (was D4) — the `EventsOn`/`EventsOff` bridge, native dialogs, and watcher are only exercised on the released desktop app; a `wails dev` + CDP driver is cross-platform-fragile. Not worth the harness today. Parked; revisit later if an EventsOn / file-watcher / native-dialog regression actually bites.
- **Analysis / coaching-insight dashboard tab** — the dev-only Analysis tab and its `MatchesDashboardSketch` were removed; the coaching-cards direction is not being pursued. Per-hero/per-session insight ideas, if they ever return, surface inside the Matches dossier, not a separate tab. (Speculative insight ideas remain parked in `FEATURES.md`.)
- **Drag-to-reorder leaf rows** — matches are immutable history ordered by `parsed_at` / `finished_at`; reordering would lie about when they happened.
- **Match comparison side-by-side view** — the detail panel is single-match. If comparison ever earns its way back, it's "tabs inside the panel", not dual inline expansion.
- **Match deletion confirmation modal** — the two-click confirm-then-act pattern in `MatchCardDanger.vue` is already correct UX.
