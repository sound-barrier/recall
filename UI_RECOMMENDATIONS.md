# UI Recommendations — Matches view

Working notes for the next pass of Matches-page modernization. The
"Operations Bay" pass on PR #57 closed the three most expensive UX
gaps (active-filter pills, aggregate stats, filtered-empty state).
What's left below is the backlog — sorted by impact-to-effort ratio,
not by which is most fun.

Use this as the menu for a future `frontend-design` session. Each
item names files to touch and the closest existing component to
mirror, so the next session can skip the survey step.

## Ready to implement (clear scope, no design research needed)

### 1. Filter-preset save & recall

Users settle into 3–4 recurring filter combos ("my placements",
"last week's stack", "support games only"). Today every visit
rebuilds the same multi-select selections by hand.

- **Storage**: `localStorage`-backed; reuse the
  `usePersistedRef` pattern from `useTheme` / `useWeekStart`.
- **API surface**: a new composable `useFilterPresets` —
  `presets`, `savePreset(name)`, `applyPreset(name)`,
  `deletePreset(name)`. Serialises every filter ref from
  `useMatchFilters`.
- **UI**: a small "Presets ▾" button in the FilterRail's
  `.filter-tools` row, dropdown lists saved presets, with a
  Save-current-as menu item that prompts for a name. Apply on
  click; long-press / × removes.
- **Effort**: ~3–4 hours including a Vitest spec for the
  composable and a Playwright e2e for the save/apply round-trip.
- **Mirror**: `useTheme.ts` for the persistence shape; the
  `MinPlayInput.vue` button family for the dropdown chrome.

### 2. Note-search hit highlighting

The just-shipped note search (`useMatchFilters.noteSearch`)
narrows the list but the matched substring isn't surfaced
inside the expanded card. Adds high information value at low
cost — *except* the note display is a `<textarea>` and `<mark>`
doesn't work inside textareas.

- **Pattern**: swap the textarea for a click-to-edit preview.
  Default state renders a `<div>` with the note text and
  `<mark>` around matched substrings; click promotes to a
  textarea focused at the cursor click position; blur reverts
  to the preview.
- **Files**: `MatchCardExpanded.vue` (note row), new helper
  `highlightSubstring(text, query)` in `match-helpers.ts`.
- **Effort**: ~2–3 hours including focus-position transfer
  and the Vitest cases for the helper.
- **Mirror**: nothing in-repo; the swap pattern is canonical
  enough that any popular editor (Notion, Linear) is a fair
  reference.

### 3. List virtualization

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

### 5. Brushable timeline / sparkline header

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

### 6. Detail panel instead of inline expansion

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

### 7. Hero × Map heatmap

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

### 8. Multi-select cards for bulk operations

Today every action is per-card. Useful bulk ops:

- Add the same tag to N matches at once.
- Bulk-hide a known-bad parse run.
- Bulk-export filtered selection.

Shift-click range select + a contextual action bar that
appears when the selection count > 0.

### 9. Match-card hover preview

Hover a card → show a small thumbnail of the screenshot in a
floating preview, anchored to the cursor. Useful for "which
match was the Rialto one with the comeback".

### 10. Smooth scroll-to-card from group jump links

The expand-all / collapse-all controls jump to top. A "jump
to group" sidebar (or sticky month/week chips along the right
gutter) would help large-history users navigate.

### 11. High-contrast theme variant

The current dark theme passes WCAG AA on every surface (verified
in the a11y e2e). A "high contrast" theme variant — pure black
background, white text, accent boosted to `#ffbf4d` — would help
users with low vision. New CSS variable layer, gated by a third
`themeMode` value.

### 12. Search across more than `annotation.note`

The note-search currently matches only `annotation.note`. Users
might expect it to also match `replay_code`, members (BattleTag
list), or arbitrary fields. Either:

- Expand to a global "search" (annotation note + replay_code +
  members + tag values).
- Or add a per-field search type-ahead, so the user types
  `note:clutch` or `member:Apollo` to scope the query.

The second is more powerful and discoverable; the first is
simpler. Pick after a usage data review.

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
