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

## Bugs & UX gaps

### B1. Mid-parse network drop has no rollback UI

**Where:** `frontend/src/App.vue` (the SSE parse stream) + `ParseProgressPanel.vue`. Server-mode only — the Wails desktop build has no network-drop scenario.

**What breaks:** if the server-mode SSE connection drops mid-parse, the progress UI has no rollback/retry affordance; the user is left with a half-finished run and no clear recovery. Deferred at 1.0 as not a desktop blocker — revisit when the headless server gets first-class UX attention. This is the highest-priority open item.

**Size:** M. **Risk:** Med.

---

## Features

### F2. Table-mode row density

**Where:** `frontend/src/composables/useDensity.ts` — `Density` is `comfortable | compact`.

**What:** the original design pass sketched a third `data` density (table-like: no card border, hairline dividers, tighter rhythm). It should land as its own renderer rather than a density override.

**Size:** M. **Risk:** Low.

### F3. In-app auto-updater

**Where:** the masthead update flow — today "Check for updates" surfaces the latest version and the user clicks "Open release page".

**What:** Wails v2 supports an in-app updater (download + apply the new binary). Deferred to 1.1.

**Size:** L. **Risk:** Med.

---

## Tech debt & refactors

### D1. `match_annotation_members` lacks a reverse `(member)` index

**Where:** the `match_annotation_members` table — PK is `(match_key, member)`, with no index on `(member)` alone. The sibling `match_annotation_tags` already carries the parallel `(tag)` index, so the schema is asymmetric.

**What breaks:** conditional — only if/when "find all matches annotated with member X" becomes a feature (bulk operations by player name, or a member-grouped widget). Today the frontend filters in-memory after loading all annotations, which is fine for small corpora; at scale the full-table scan would bite.

**Plan:** deferred per YAGNI. When the feature lands, add `CREATE INDEX idx_match_annotation_members_member ON match_annotation_members (member)` in a migration.

**Size:** S. **Risk:** Low.

### D2. Split `MatchesView.vue` into SFCs (~800-line orchestration target)

**Where:** `frontend/src/components/MatchesView.vue` (~2,950 lines, dominated by `<style scoped>`).

**What:** the "set workspace" bundles the dossier, Campaign Log timeline, narrow panel, members list, bulk-action bar, and archive drawer. Nothing breaks today — it's shaped but verbose; the cost is review time. Step 0 (`useArchiveSelection`) already shipped. Plan, in order: extract `MatchesDossier.vue`, then `MatchesNarrowPanel.vue`, then `MatchesArchiveDrawer.vue`; MatchesView shrinks to orchestration. (`MatchCardExpanded.vue` is the sibling candidate.) Defer until the maintainer is blocked on a feature *because of* file size.

**Size:** L. **Risk:** Med — scoped-CSS `data-v-*` hashes change per extraction; any cross-component selector that piggybacked on MatchesView's hash must follow.

### D3. Finish the `log/slog` migration

**Where:** ~16 legacy `log.Printf` sites in `pkg/app/`, `pkg/metrics/`, and `pkg/cmd/server_profiles.go`.

**What:** the `pkg/applog` seam shipped and the highest-volume sites (`watcher.go`, `server.go`) migrated; the rest flow through the same handler via the `log.SetOutput(slogWriter{…})` shim, so this is purely about adopting structured fields, not output. Sweep opportunistically as files are touched.

**Size:** S. **Risk:** Low.

### D4. Real desktop-runtime e2e for Wails

**Where:** `frontend/tests/e2e/` drives the `serveronly` binary exclusively.

**What:** the `EventsOn`/`EventsOff` runtime bridge, the native dialogs (`PickScreenshotsDir` / `PickTesseractBinary`), and the watcher's real-OS interaction are only exercised on the released desktop app. Steps 1–2 of the ladder shipped (`make smoke-wails` compile check + AssetServer-shim unit coverage). Plan: integrate a Wails runtime driver (`wails dev` + `playwright connect` over CDP to the embedded WebView). Cross-platform-fragile — wait until an EventsOn / file-watcher / native-dialog regression actually bites.

**Size:** XL. **Risk:** Med.

---

## Design & polish

### P1. Split `--accent` into interactive vs identity hues

**Where:** the CSS custom-property palette in `frontend/src/styles/app.css`.

**What:** `--accent` currently does double duty as both the interactive-affordance colour and the OW-identity accent. Split into `--interactive-accent` vs an identity accent. Needs a design pass to pick the second hue; the rest is mechanical. Revisit when a design spec lands.

**Size:** M. **Risk:** Low.

---

## Out of scope — deliberately not building

- **Analysis / coaching-insight dashboard tab** — the dev-only Analysis tab and its `MatchesDashboardSketch` were removed; the coaching-cards direction is not being pursued. Per-hero/per-session insight ideas, if they ever return, surface inside the Matches dossier, not a separate tab. (Speculative insight ideas remain parked in `FEATURES.md`.)
- **Drag-to-reorder leaf rows** — matches are immutable history ordered by `parsed_at` / `finished_at`; reordering would lie about when they happened.
- **Match comparison side-by-side view** — the detail panel is single-match. If comparison ever earns its way back, it's "tabs inside the panel", not dual inline expansion.
- **Match deletion confirmation modal** — the two-click confirm-then-act pattern in `MatchCardDanger.vue` is already correct UX.
