# Technical Debt

Living inventory of known technical debt in the Recall codebase. Each
item has the same five-section shape so they can be triaged, scoped,
and worked off independently. Update this file whenever debt is added
(record it the same week, with the same rigor) or paid down (delete
the section — not "strikethrough", not "✅", just delete it; git
history is the audit trail).

## How to read this file

Each item carries two estimates — **size** (coding effort + review
surface) and **risk** (what could break) — so triage can favour
items with low cost AND low blast radius first.

| Size | Rough effort | Examples |
|---|---|---|
| **S**  | < 2 hours | A single-file rename, one Makefile var, one config flip. |
| **M**  | ½–2 days | A refactor inside one package; new test file; small DI seam. |
| **L**  | 2–5 days | Multi-package refactor; new abstraction with migrations; CI rewiring. |
| **XL** | 1–2 weeks | Rewriting a monolith; introducing a new runtime dependency; reshaping an entire layer. |

| Risk | What "breaks" means here |
|---|---|
| **Low**  | Local refactor; if it slips, the diff is small and lint/test catch it. |
| **Med**  | Touches multiple layers or a shared abstraction; CI may not catch everything; needs careful staging or a feature flag. |
| **High** | SQLite schema, on-disk format, public URL shape, or build-tag-conditioned behaviour. Mistakes can corrupt user data or strand existing installs. |

A **plan** is a sequence of *small, independently mergeable* steps.
If a step needs a release or a contributor handoff, that's marked in
line. Anything that has to land atomically is called out.

The list is ordered by *risk × cost-to-fix-later*, not by size. The
top items are the ones most likely to bite if left alone. Pay them
off first.

## How to add a new entry

When you find debt, capture it the same week with the same shape:

```markdown
## N. Short headline — what's broken in one phrase

**Where:** file:line + a sentence explaining the surface area.

**What breaks:** one paragraph; concrete user-visible or
contributor-visible failure mode. Avoid "this is ugly" framings —
articulate the cost.

**Plan:** numbered steps that are independently mergeable.

**Size:** S/M/L/XL.
**Risk:** Low/Med/High.
```

Keep the numbering stable across edits — gaps in the sequence are
fine, never renumber. When a section is paid down in full,
*delete* it; the git log is the audit trail.

## 21. Persistent filter rail at ≥1400 px — demodalify NarrowPopover

**Where:** `frontend/src/components/NarrowPopover.vue`,
`frontend/src/components/MatchesView.vue` (the Matches grid).

**What breaks:** at wide viewports the "Narrow this set" filter
panel is a modal popover with a focus trap, backdrop, and
background-`inert` cascade. Modern data tools (Linear, Notion,
Raycast) treat filters as a peer rail at peer densities; popping
a modal for every filter touch wastes the screen real estate
that's available. Mouse users with 1440 + width displays
constantly open / close / re-open it.

**Plan:**

1. Carve a `NarrowRail` SFC that shares the popover's filter
   logic but renders as a static aside without focus trap,
   backdrop, or inert wrappers.
2. At `width ≥ 1400 px`, MatchesView's grid template becomes
   `auto 1fr` with the rail filling the auto column.
3. The popover stays for `< 1400 px` — same trigger button + same
   transitions.
4. Persist a `useNarrowMode = 'rail' | 'popover'` override
   (default = viewport-driven) so users can force one even on
   the other viewport size.
5. e2e: extend `match-narrow-search.spec.ts` + sibling specs to
   set the viewport before running so both modes get coverage.

**Size:** L.
**Risk:** Med — MatchesView is the most-touched view and the
narrow plumbing has many keyboard / focus edges.

## 23. Campaign Log sticky-on-scroll with compact-when-sticky

**Where:** `frontend/src/components/MatchTimelineHeader.vue` +
the mounting point in `MatchesView.vue`.

**What breaks:** the Campaign Log (heatmap + sparkline) carries
the most context-rich visualisation in the view but scrolls away
the moment the user reads into the leaves list. Sticky at full
height occupies too much viewport — it's a tall block. The fix
is a sticky behaviour that compresses the timeline as it pins
(heatmap row goes single-line, sparkline goes thinner) so the
information stays accessible without dominating the viewport.

**Plan:**

1. Wrap the timeline in a sticky positioner with two CSS-only
   render modes: `expanded` (default position) and `sticky`
   (after the IntersectionObserver fires).
2. Compact-sticky styles drop the heatmap to ~24 px tall and the
   sparkline to ~32 px.
3. Reduce the sticky-mode brush interactivity to keep it
   read-only (full interactivity returns when scrolled back to
   top).

**Size:** M.
**Risk:** Low — the timeline is its own SFC, isolated blast
radius. Sticky requires checking the matches-view scrolling
ancestor; do that audit first.
