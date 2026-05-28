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

- **Source**: prefer the SUMMARY screenshot (most recognisable
  thumbnail); fall back to TEAMS if SUMMARY is missing.
- **Constraint**: must not stutter on long lists — preload the
  hovered card's source img with `prefetch` link tags on
  visibility, not on hover.
- **Effort**: ~3 hours. Mirror `MatchCardExpanded.vue`'s
  `<img class="source-preview">` chrome.

### 7. Sticky FilterRail summary on scroll

Once the user scrolls past the FilterRail (large filtered
sets push it off-screen quickly), the active-filter state
becomes invisible. A compressed sticky strip — `4 of 87 ·
clutch · tag:stack · 2026-05-01 → 2026-05-15 · Clear all`
— would keep the answer to "what am I looking at" one glance
away regardless of scroll depth.

- **Where**: pinned `position: sticky; top: 0` on the
  MatchesView's `<main>` container, slides in only when the
  full FilterRail has scrolled off; eased opacity / translateY
  transition.
- **Constraint**: must NOT introduce a new sticky context
  inside the existing card-list scroll — keep the rail strip
  at the same DOM depth as the FilterRail so the scroll
  context stays the same.
- **Effort**: ~3 hours. Mirror the existing
  `MatchesFilterPills.vue` chip vocabulary.

### 8. Inline tag autocomplete

The tag input in the Match Journal accepts free text but
doesn't help the user discover their existing tag vocabulary.
Typing into the input should drop a small popover listing
matching tags from `useMatchFilters.tags` (already computed),
plus an "add new tag" affordance.

- **Pattern**: combobox with arrow-key navigation; Enter on
  a selection adopts the tag, Enter on free text adds it as
  new. Same focus-flow as the existing FilterRail multi-select.
- **Constraint**: the popover sits inside the Match Journal
  cell, which is itself inside the expanded card — z-index
  collisions with the FilterRail multi-select popovers and
  the FilterPresetsMenu need explicit ordering.
- **Effort**: ~4 hours. Mirror `FilterRail.vue`'s `.mf-row`
  shape for the popover.

### 9. Smart-empty filter messaging

The current empty-state ("No matches fit these filters") is
correct but unhelpful. When the filter set excludes every
record, suggest the closest non-empty combination — drop the
clause with the smallest contribution to the exclusion
("Try removing `note:clutch` — 12 matches would surface").

- **Algorithm**: for each active filter clause, count how
  many records the rest-of-the-filter-set would surface
  without it; rank by the resulting count, show the top 1–2
  removals as one-click suggestions.
- **Constraint**: filter recomputation per-suggestion is
  O(filters × records); cache the per-clause exclusions
  inside the `useMatchFilters` computed so the UI suggestion
  is O(filters).
- **Effort**: ~4 hours. Filter math expansion in
  `useMatchFilters.ts`; new component
  `MatchesFilteredEmpty.vue` replacing the inline empty-state
  block in `MatchesView.vue`.

### 10. Right-click context menu on cards

Fast-track per-card actions without forcing the user to
expand the card first: Hide, Tag, Star, Copy replay code,
Copy match link, Edit annotation, Open source folder. Lives
on the right-click contextmenu; left-click stays "expand".

- **Constraint**: the native browser context menu must remain
  accessible via Shift+Right-click; the app's menu only fires
  on the standard right-click path.
- **Constraint**: keyboard-accessible — Menu key (`Apps`) on
  the focused card opens the same menu.
- **Effort**: ~5 hours. Mirror the `KeyboardShortcutsModal`'s
  modal pattern but with positioned anchoring.

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
  surface levels, text levels). Three themes now live behind
  `[data-theme]`: dark (default; the tactical OW-HUD ground
  state), light (cream paper editorial), high-contrast
  (tournament-booth / low-vision; pure black + boosted gold).
  Verify any new colour decision in all three palettes before
  shipping; the a11y e2e pins to dark, so per-theme contrast
  drift in light or contrast is your job to catch.
- **WCAG AA on every surface**. The a11y e2e spec catches
  regressions in dark mode (the canonical sweep), but the
  contrast budget at small text sizes is tight — `--text-mute`
  at `#838690` is the floor that still clears 4.5:1 on
  `--surface-3` in dark mode. Light mode rebalanced the
  cream-paper palette (#c2410c rust accent, #6c695a text-mute)
  to hit AA on every surface after an earlier 1.78:1 regression
  on bright orange.
- **Scoped-style leak rule**. Any class referenced by more
  than one SFC's template lives in `frontend/src/styles/app.css`.
  Vue rewrites scoped selectors with a per-component
  `data-v-<hash>` attribute and the hash doesn't cascade —
  scoped styles in a parent component never reach child SFCs.
  Vue also miscompiles `:global(X) .y { ... }` to a bare `X
  { ... }` rule that matches `<html>` directly — put
  cross-theme overrides in `app.css` under a parent id, never
  in scoped `<style>` blocks (see root CLAUDE.md "Vue scoped
  miscompiles").
- **TDD for UI**. Every new user-facing affordance starts with
  a failing Playwright spec in `frontend/tests/e2e/`. The
  match-tags, global match search, and theme work are the
  canonical patterns: write the e2e against the live UI
  contract (aria-labels, `data-*` attributes, observable DOM
  state), THEN build the component. The unit-test pattern
  (`mountApp(overrides)` in `test-utils/mountApp.ts`) is for
  composable contracts + render branches, not for proving
  the transport chain works.
- **Breaking changes are fine, just declare them**. Pre-1.0
  the project explicitly allows breaking changes at every
  layer (HTTP `/api/v1/`, Wails IPC, SQL schema, settings.json,
  exported Go API, on-disk export format). Use `feat!:` or a
  `BREAKING CHANGE:` footer on the commit — release-please
  picks up the marker and cuts the right SemVer bump. Don't
  add backwards-compat shims for "soft landings"; declare and
  break clean (see root CLAUDE.md).
- **Bundle budgets** are CI-enforced (`ci.yml` "Enforce
  bundle-size budget"): init JS < 135 KB, init CSS < 80 KB,
  total JS < 250 KB, total CSS < 145 KB. New features that
  push these caps should bump deliberately (with a comment
  explaining why) rather than golf the implementation past
  readability.
