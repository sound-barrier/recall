# Review — outstanding features & tech debt

Single living backlog for Recall: outstanding feature work, known
technical debt, and the things we've deliberately decided **not** to
build. Consolidates the former `UI_RECOMMENDATIONS.md` (UI/feature
backlog) and `TECHNICAL_DEBT.md` (engineering debt) — both had drained
to a handful of live items, captured below; the shipped history lives in
git.

Record new items the same week you find them, with the same rigor. When
an item ships or is paid down, **delete** its section — no
strikethrough, no "✅", just delete it; git history is the audit trail.
Item ids stay stable (gaps are fine; never renumber).

## Effort tags

Each item carries **size** (coding effort + review surface) and **risk**
(what could break) so triage can favour low-cost, low-blast-radius items
first.

| Size | Rough effort |
|---|---|
| **S** | < 2 hours — a single-file change, one config flip. |
| **M** | ½–2 days — a refactor inside one package/view; new test file. |
| **L** | 2–5 days — multi-package refactor; new abstraction. |
| **XL** | 1–2 weeks — reshaping a whole layer. |

| Risk | What "breaks" means |
|---|---|
| **Low** | Local; a slip is a small diff that lint/test catch. |
| **Med** | Touches multiple layers or a shared abstraction; stage carefully. |
| **High** | SQLite schema, on-disk format, public URL shape, or build-tag-conditioned behaviour — mistakes can corrupt user data or strand installs. |

---

## Outstanding — features

### F1. Scoped-clause search in the narrow panel

**Where:** `frontend/src/search-query.ts` + `frontend/src/composables/useSearchClauses.ts` ship and are unit-tested, but the "Narrow this set" panel's search box (`narrowPredicates.matchesSearch`) only does plain substring matching across every lexical surface (map / hero / game_mode / note / tag / heroes-played).

**What:** restore the `note:` / `tag:` / `member:` / `replay:` scoped-clause UX inside the narrow-panel search so power users can target a single surface. The parser helper already exists; this is UI wiring plus a failing Playwright e2e first.

**Size:** M. **Risk:** Low.

### F2. Table-mode row density

**Where:** `frontend/src/composables/useDensity.ts` — `Density` is `comfortable | compact`.

**What:** the original design pass sketched a third `data` density (table-like: no card border, hairline dividers, tighter rhythm). It should land as its own renderer rather than a density override; deferred until table-mode earns its own scope.

**Size:** M. **Risk:** Low.

### F3. Analysis dashboard — chart-click slice scoping (dev-only)

**Where:** `frontend/src/components/MatchesDashboardSketch.vue`, lazy-loaded behind the dev-build-only Analysis tab.

**What:** the slide-out drawer surfaces the top-N most-recent matches; honor a chart click that scoped to a specific slice so the drawer reflects the clicked segment instead of always showing recents.

**Size:** M. **Risk:** Low.

---

## Outstanding — tech debt

### D1. `match_annotation_members` lacks a reverse `(member)` index

**Where:** the `match_annotation_members` table — PK is `(match_key, member)`, with no index on `(member)` alone. The sibling `match_annotation_tags` already carries the parallel `(tag)` index, so the schema is asymmetric.

**What breaks:** conditional — only if/when "find all matches annotated with member X" becomes a feature (bulk operations by player name, or a member-grouped dossier widget). Today the frontend filters in-memory after loading all annotations, which is fine for small corpora; at scale the full-table scan would bite.

**Plan:** deferred per YAGNI. When the feature lands, add `CREATE INDEX idx_match_annotation_members_member ON match_annotation_members (member)` in a migration.

**Size:** S. **Risk:** Low.

---

## Out of scope — deliberately not building

- **Drag-to-reorder leaf rows** — matches are immutable history ordered by `parsed_at` / `finished_at`; reordering would lie about when they happened.
- **Match comparison side-by-side view** — the detail panel is single-match. If comparison ever earns its way back, it'd be "tabs inside the panel", not a return to dual inline expansion.
- **Match deletion confirmation modal** — the two-click confirm-then-act pattern in `MatchCardDanger.vue` is already correct UX; no upgrade needed.
