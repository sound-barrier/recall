# UI Recommendations — Matches view

Working notes for the next pass of Matches-page modernization. The
"Operations Bay" pass on PR #57 closed the three most expensive UX
gaps (active-filter pills, aggregate stats, filtered-empty state).
Since then: **filter-preset save & recall** (Presets dropdown +
`useFilterPresets`), **collapsible Heroes Played + Match Journal**
redesign, **global match search** with vim-style scoped clauses
(`note:` / `replay:` / `member:` / `tag:`), the **group-jump
timeline rail** (sticky right-edge chip column that scrolls + auto-
expands the target month on click), and the **high-contrast theme
variant + OS-preference autodetect** have all shipped. What's left
below is the remaining backlog — sorted by impact-to-effort ratio,
not by which is most fun.

Use this as the menu for a future `frontend-design` session. Each
item names files to touch and the closest existing component to
mirror, so the next session can skip the survey step.

## Ready to implement (clear scope, no design research needed)

### 1. List virtualization

`MatchGroupSection.vue` renders every card in the DOM. Fine
through ~200 matches; degrades past ~500. Mid-tier user (year
of matches) is already past the comfortable point.

- **Library**: `vue-virtual-scroller` is the closest fit for
  Vue 3 + Vite; existing match-card height is small + uniform
  enough that fixed-height virtualization works.
- **Constraint**: the per-month group headers + per-week
  sub-headers need to be in the virtual list too, not pinned
  outside. Variable-height virtualization (`<DynamicScroller>`)
  handles this but is heavier.
- **Effort**: ~6–8 hours. Performance verification needed —
  add a test fixture with 1000+ records and check first-paint
  before and after.
- **Tradeoff**: adds a dependency. Discuss before pulling the
  trigger.

## Needs design exploration

### 2. Brushable timeline / sparkline header

The match list is a time series. A small histogram of match
volume over time at the top of the page, brushable to set the
date-range filter, would be both decorative AND functional.

- **Open question**: where does it live without overlapping
  the FilterRail / AggregateStats? Possibly *inside* the
  AggregateStats panel as a fourth cell, possibly above the
  FilterRail as its own strip.
- **Open question**: SVG (sharp + accessible) vs Canvas
  (cheaper at high density). At ~500 bars SVG is fine; past
  that Canvas wins.
- **Constraint**: must respect `prefers-reduced-motion`. No
  hover-tooltip auto-show; drag-select is the interaction.
- **Effort**: ~6–8 hours. Wireframe first; do not start in
  code.

### 3. Detail panel instead of inline expansion

Inline expansion (current behavior) is good for scanning
adjacent cards but bad for deep inspection — the user loses
scroll position when collapsing, and the editor surfaces compete
for vertical space with the rest of the list.

- **Pattern**: click a card → opens a side panel from the
  right; ESC or click-out closes; `j` / `k` paginates within
  the open panel without scrolling the underlying list.
- **Architectural cost**: significant — MatchCardExpanded
  becomes a standalone panel mounted at the page root, not a
  child of the card. Routing-style state management
  (which match is "selected") needs to be added.
- **Tradeoff**: better for deep inspection, worse for
  side-by-side comparison. Could ship both with a user
  preference.
- **Effort**: ~10–12 hours. Probably its own PR.

### 4. Hero × Map heatmap

For users with hundreds of matches, "which heroes win on which
maps" is a real question. A small heatmap (rows = heroes,
columns = map types) over the currently-filtered set would
surface non-obvious patterns.

- **Where**: probably a fourth section after the
  AggregateStats panel, gated behind an "Insights" tab toggle
  so the default view stays the linear list.
- **Open question**: granularity. Per-map (~25 columns) is
  noisy but maximally informative; per-map-type (~6 columns)
  is readable but coarse.
- **Effort**: ~6 hours including the cell rendering + an
  empty-state for filter sets too small to be statistically
  meaningful (<20 matches?).

## Polish / lower-priority

### 5. Multi-select cards for bulk operations

Today every action is per-card. Useful bulk ops:

- Add the same tag to N matches at once.
- Bulk-hide a known-bad parse run.
- Bulk-export filtered selection.

Shift-click range select + a contextual action bar that
appears when the selection count > 0.

### 6. Match-card hover preview

Hover a card → show a small thumbnail of the screenshot in a
floating preview, anchored to the cursor. Useful for "which
match was the Rialto one with the comeback".

## Out of scope (deliberately not recommending)

- **Drag-to-reorder match cards** — matches are immutable
  history, the order is `parsed_at`/`finished_at`. Reordering
  would be lying.
- **Match comparison side-by-side view** — niche enough that
  detail-panel + future tabs in the panel can cover it later.
- **Match deletion confirmation modal** — the existing
  two-click confirm-then-act pattern in `MatchCardDanger.vue`
  is already correct UX; no upgrade needed.

## Implementation notes for the next session

- **Keep the aesthetic**. Big Noodle italic for display, mono
  for eyebrows / data / values, body font for paragraphs. The
  palette is settled (`--accent`, `--win` / `--loss` / `--draw`,
  surface levels, text levels). Don't add new tokens unless
  the existing palette genuinely can't carry the new surface.
- **WCAG AA on every surface**. The a11y e2e spec catches
  regressions, but the contrast budget at small text sizes is
  tight — `--text-mute` at `#838690` is the floor that still
  clears 4.5:1 on `--surface-3` in dark mode.
- **Scoped-style leak rule**. Any class referenced by more
  than one SFC's template lives in `frontend/src/styles/app.css`.
  Vue rewrites scoped selectors with a per-component
  `data-v-<hash>` attribute and the hash doesn't cascade —
  scoped styles in a parent component never reach child SFCs.
- **TDD for UI**. Every new user-facing affordance starts with
  a failing Playwright spec in `frontend/tests/e2e/`. The
  match-tags and match-notes-search work is the canonical
  pattern.
