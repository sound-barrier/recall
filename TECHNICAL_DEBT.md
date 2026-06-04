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

## 20. Day-theme color-contrast pass — bring day theme up to AA across matches view

**Where:** `frontend/src/styles/app.css` (the `[data-theme="day"]`
palette around lines 130–174) plus every consumer of
`--accent-text` and `--primary-text-on-accent` in day. Loudest
offenders surfaced by axe so far: `.seg-btn.picked`,
`.leaves-eyebrow`, `.skip-link` and most modal-button
text-on-accent fills, every `.hero-name` / `.length-mark` /
`.source-type-summary` rule. Day's `--accent-text` is `#b8650a`
on `#f5f3ed` (~3.85:1), `--primary-text-on-accent` is `#fff8ef`
on `#fa9c1b` (~1.92:1) — both sub-AA.

**What breaks:** running `frontend/tests/e2e/a11y.spec.ts` with
the day theme pinned currently raises serious `color-contrast`
violations. PR C added a matches-view × theme axe loop covering
dark / night / high-contrast and explicitly excluded day with a
comment pointing at this entry. Day-theme users (and anyone with
matching OS preferences) see small uppercase callouts and
text-on-accent fills below the WCAG 2 AA 4.5:1 threshold for
small bold text.

**Plan:**

1. Darken `--primary-text-on-accent` for day from `#fff8ef` →
   `#1a0a00` (or another dark brown that clears AA on
   `--accent` `#fa9c1b`). Verify the skip-link, the picked
   seg-btn, every modal-button "Save"/"Done" fill, and the
   active-tab underline label.
2. Darken `--accent-text` for day to a value that clears 4.5:1
   on `--surface` (`#f5f3ed`) — likely `#9e4d00` or thereabouts.
   Audit every `.hero-name`, `.length-mark`,
   `.source-type-summary`, `.leaves-eyebrow`, the chip border
   text, and the dossier section eyebrows.
3. Drop the `'day'` exclusion from the `THEMES` array in
   `frontend/tests/e2e/a11y.spec.ts` and the corresponding
   comment; rerun `make test-e2e -g "day theme"` and watch the
   violation list trend to zero.
4. Manual visual eyeball — the rust-orange becomes meaningfully
   darker in day theme. Sanity-check brand identity against the
   in-game OW post-match summary screen (the cream-on-orange
   that day theme references).

**Size:** M.
**Risk:** Low for steps 1–3 (theme-scoped CSS + test config);
Med for step 4 (subjective brand-feel review against the OW
identity day theme references).

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

## 22. Combined Sort + Group dropdown in the Matches head

**Where:** `frontend/src/components/MatchesView.vue` (the
`.leaves-head-controls` row).

**What breaks:** Sort + Group are two separate fieldsets,
together taking ~12 segmented buttons of horizontal real estate
above the leaves list. The Density picker (PR E) added a third
fieldset, pushing the row toward overflow on the
~1280 px viewport. A single combo button with both axes inside a
dropdown saves horizontal space and reduces cognitive load
("how am I cutting this list?" = one menu, not three rows of
chips).

**Plan:**

1. Wrap Sort + Group in a single trigger button labelled e.g.
   "Newest · By day" reflecting the current state.
2. The trigger opens a small panel with two radio groups
   (Sort + Group), preserves keyboard nav, fires changes via the
   existing `sortOrder` / `groupBy` refs.
3. Existing per-button e2e selectors (the `.seg-btn.picked` reads)
   move to scoped selectors inside the menu.
4. Density picker stays as its own fieldset (it's
   ergonomically different — toggle, not multi-axis).

**Size:** M.
**Risk:** Med — multiple e2e specs target the fieldsets directly.

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

## 24. Visual candidate thumbnails for ambiguous-resolution picker

**Where:** `frontend/src/components/UnknownMapsView.vue` —
ambiguous section's candidate picker (around line 240).

**What breaks:** when an ambiguous screenshot has 3-5 candidate
matches, the picker shows text-only metadata (map / hero / date /
winrate). Users with similar-looking screenshots from the same
sitting can struggle to pick the right candidate without flipping
back to the leaves list. A small thumbnail of each candidate's
own SUMMARY screenshot beside its text label would resolve the
ambiguity at a glance — which is the whole point of this tab.

**Plan:**

1. Extend the `candidates[]` shape to carry a representative
   `source_file` per candidate (the candidate match's earliest
   SUMMARY screenshot is a natural pick).
2. Render a small thumbnail (`<img>` via `screenshotURL()`)
   beside each candidate label.
3. Lazy-load each thumbnail (`loading="eager"` was avoided by
   prior PR for collapsed cards — thumbs in this picker are
   never collapsed once the card expands, so eager is fine).
4. Existing `unknown-tab-screenshot-lightbox.spec.ts` extension
   covers the click-to-lightbox behaviour for the new thumbs.

**Size:** M.
**Risk:** Low — picker is isolated UI, no shared selectors.
