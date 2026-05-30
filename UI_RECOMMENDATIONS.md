# UI Recommendations — Matches view

Working notes for the next pass of Matches-page modernization.
PR #100 shipped the **set-workspace redesign** — the FilterRail
multi-popover is replaced by a single left-side *"Narrow this
set"* panel; the AggregateStats panel + nested
Month→Week→Day expand tree is replaced by a top-of-page **dossier**
(KPIs + W/L/D + top maps/heroes + active-clause chips); per-match
cards collapse into compact **leaf rows** that drill into the
existing right-side detail panel. Hero / Map pickers use the new
`FilterCombobox` (typeahead + selected pills + dropdown listbox).
Filter math lives in `useMatchesNarrow`; sort + Y/M/W/D bucketing
in `useMatchesGroup`; KPI math in `useMatchesDossier`. The
heatmap + brushable sparkline (formerly item #2 below) shipped via
`MatchTimelineHeader` and sits between the dossier and leaves.

PR #101 paid down the post-merge debt: dead `useFilterPanel` /
`useMatchGrouping` / `useFilterPresets` / `useDensityMode` removed
(~1100 lines), the `selection` source rebound to
`matchesNarrow.narrowedRecords` so the detail panel's prev/next +
auto-close-on-hide contracts work again.

What remains below is the live backlog — sorted by
impact-to-effort, not by which is most fun. Use this as the menu
for a future `frontend-design` session. Each item names files to
touch and the closest existing component to mirror, so the next
session can skip the survey step.

## Recently shipped (was on this list)

- ~~**Brushable timeline / sparkline header**~~ — shipped as
  `MatchTimelineHeader.vue` (3M/6M/12M window picker;
  `MatchHeatmapHeader.vue` + `MatchSparklineBrush.vue` siblings;
  `useMatchHeatmap.ts` for cell bucketing). 16 e2e tests in
  `match-heatmap.spec.ts` (currently `describe.skip` pending
  rewrite for the new layout — same feature; the rewrites are
  tracked under the e2e backlog).
- ~~**Sticky FilterRail summary on scroll**~~ — subsumed by the
  dossier headline + active-clause chips. The dossier is always at
  the top of the page; scrolling past the leaves never hides the
  filter state because the dossier sticks with the user via
  natural scroll position, and the narrow-panel chips are visible
  inside the dossier the moment a filter is active.
- ~~**Right-edge detail panel + screenshot lightbox + keyboard
  cheatsheet**~~ — shipped with PR #99 (pre-redesign) and the
  set-workspace redesign rebinds `selection` so prev/next +
  auto-close work correctly against the visible filtered set.

## Ready to implement (clear scope, no design research needed)

### 1. Leaf-row virtualization

`MatchesView.vue`'s leaves list (the `<ul class="leaves-list">`
inside the Members section) renders every visible match's
`<li class="leaf-row">` to the DOM. Fine through ~200 rows;
degrades past ~500. With `groupBy: 'none'` the list is flat (~one
row per match); with `groupBy: 'day'` (default) thin
`<li class="section-divider">` headers interleave but most of the
DOM weight is still leaf rows. A mid-tier user (year of matches)
is already past the comfortable point.

- **Library**: `vue-virtual-scroller` is the closest fit for
  Vue 3 + Vite; leaf-row height is small + uniform enough that
  fixed-height virtualization works for `groupBy: 'none'`. For
  the grouped variants the section dividers need to be in the
  virtual list too — `<DynamicScroller>` handles mixed-height,
  but it's heavier.
- **Constraint**: the row click handler (`@click="emit('open-match', …)"`)
  needs to survive virtualization. Mirror what
  `vue-virtual-scroller` recommends for click handlers on
  recycled items.
- **Effort**: ~6–8 hours. Performance verification needed —
  add a test fixture with 1000+ records and check first-paint
  before and after.
- **Tradeoff**: adds a dependency. Discuss before pulling the
  trigger.

## Needs design exploration

### 2. Hero × Map heatmap

For users with hundreds of matches, "which heroes win on which
maps" is a real question. A small heatmap (rows = heroes,
columns = map types) over the currently-filtered set would
surface non-obvious patterns the dossier's top-N breakdowns
miss.

- **Where**: a fourth dossier section, below the existing
  top-maps + top-heroes breakdowns. Could also live on the
  Analysis tab as a wider grid. The set-workspace dossier
  already commits to "first-class set-as-an-object" framing —
  a hero×map cell *is* a subset descriptor, so it fits.
- **Open question**: granularity. Per-map (~25 columns) is
  noisy but maximally informative; per-map-type (~6 columns)
  is readable but coarse.
- **Open question**: cell-click semantics. Most natural:
  clicking a cell adds the (hero, map) pair as a narrow clause
  (`narrow.pickMap` + `narrow.pickHero`) — drills the user
  into the matching subset without leaving the page.
- **Effort**: ~6 hours including the cell rendering + an
  empty-state for filter sets too small to be statistically
  meaningful (<20 matches?).

## Polish / lower-priority

### 3. Multi-select rows for bulk operations

Today every action is per-row → detail panel → action. Useful
bulk ops:

- Add the same tag to N matches at once.
- Bulk-hide a known-bad parse run.
- Bulk-export filtered selection (JSON or CSV).

Shift-click range select on `.leaf-row` + a contextual action
bar that anchors to the bottom of the leaves list when the
selection count > 0.

- **Constraint**: row click already opens the detail panel.
  Shift-click as the multi-select gesture; Cmd/Ctrl-click for
  toggle. Make the bottom-anchored bar dismissible with Esc and
  honor `prefers-reduced-motion` on the slide-in.
- **Effort**: ~5 hours. New `useRowSelection` composable for
  the selection state + a `MatchesBulkBar.vue` for the action
  surface.

### 4. Leaf-row hover preview

Hover a row → show a small thumbnail of the SUMMARY screenshot
in a floating preview, anchored to the cursor. Useful for
"which match was the Rialto one with the comeback".

- **Source**: prefer the SUMMARY screenshot (most recognisable
  thumbnail); fall back to TEAMS if SUMMARY is missing.
- **Constraint**: must not stutter on long lists — preload the
  hovered row's source img with `prefetch` link tags on
  visibility, not on hover.
- **Constraint**: must NOT fire on touch devices (no hover
  affordance there). Gate via `(hover: hover) and (pointer: fine)`
  media query.
- **Effort**: ~3 hours. Mirror `MatchCardExpanded.vue`'s
  `<img class="source-preview">` chrome.

### 5. Inline tag autocomplete

The tag input in the detail panel's Match Journal accepts free
text but doesn't help the user discover their existing tag
vocabulary. Typing into the input should drop a small popover
listing matching tags from `narrow.availableTags` (already
computed by `useMatchesNarrow`), plus an "add new tag"
affordance.

- **Pattern**: combobox with arrow-key navigation; Enter on
  a selection adopts the tag, Enter on free text adds it as
  new. The new `FilterCombobox.vue` is most of the pattern
  already — extract the dropdown + a11y bits into a
  lower-level `TypeaheadDropdown.vue` that both consumers
  share.
- **Constraint**: the popover sits inside the Match Journal
  cell, which is itself inside `MatchDetailPanel` (already
  the topmost modal). z-index needs to clear the panel's
  `box-shadow` but stay below the lightbox.
- **Effort**: ~4 hours. Lower-level extraction first; tag
  autocomplete second.

### 6. Smart-empty filter messaging

The current empty-state ("No matches in this set.") is correct
but unhelpful. When the narrow excludes every record, suggest
the closest non-empty combination — drop the clause with the
smallest contribution to the exclusion ("Try removing
`note:clutch` — 12 matches would surface").

- **Algorithm**: for each active narrow clause, count how many
  records the rest-of-the-narrow-set would surface without it;
  rank by the resulting count, show the top 1–2 removals as
  one-click suggestions.
- **Constraint**: filter recomputation per-suggestion is
  O(clauses × records); cache the per-clause exclusions inside
  `useMatchesNarrow` so the UI suggestion is O(clauses).
- **Effort**: ~4 hours. Filter-math expansion in
  `useMatchesNarrow.ts` + a new `MatchesEmptySuggestions.vue`
  rendered inside the existing `.leaves-empty` block.

### 7. Right-click context menu on rows

Fast-track per-row actions without forcing the user to open the
detail panel first: Hide, Tag, Star, Copy replay code, Copy
match link, Edit annotation, Open source folder. Lives on the
right-click contextmenu; left-click stays "open detail panel".

- **Constraint**: the native browser context menu must remain
  accessible via Shift+Right-click; the app's menu only fires
  on the standard right-click path.
- **Constraint**: keyboard-accessible — Menu key (`Apps`) on
  the focused row opens the same menu.
- **Effort**: ~5 hours. Mirror `KeyboardShortcutsModal`'s
  modal-but-positioned pattern.

### 8. Restore saved-set / preset feature

PR #100 deleted the old `FilterPresetsMenu` + `useFilterPresets`
composable because it had no UI hook after the FilterRail
tear-down. Some users (the maintainer included) had non-trivial
preset collections in localStorage. Re-introducing presets is
straightforward now that filter state is parent-owned + typed:

- **Storage**: copy the old `useFilterPresets.ts` shape, but
  serialize `MatchesNarrowState` (the 14-ref bundle), not the
  legacy `FilterPresetSnapshot`. New JSON key:
  `recall.narrowPresets.v2` to avoid replaying the dead v1 keys.
- **UI**: a "Saved sets" affordance in the narrow panel
  footer — `Save current narrow as…` text-input + list of
  named presets with apply / delete glyphs.
- **Effort**: ~4 hours including a `useNarrowPresets.test.ts`
  - an `e2e` spec that proves Save → Reload → Apply re-
  applies the same narrow.

## Out of scope (deliberately not recommending)

- **Drag-to-reorder leaf rows** — matches are immutable
  history; the order is `parsed_at` / `finished_at`.
  Reordering would be lying.
- **Match comparison side-by-side view** — the detail panel
  is single-match; if comparison ever earns its way back in,
  it'd be a future "tabs inside the panel" extension, not a
  return to dual inline expansion.
- **Match deletion confirmation modal** — the existing
  two-click confirm-then-act pattern in `MatchCardDanger.vue`
  (still used by the detail panel) is already correct UX; no
  upgrade needed.

## Implementation notes for the next session

- **Keep the aesthetic**. Big Noodle italic for display, mono
  for eyebrows / data / values, body font for paragraphs. The
  palette is settled (`--accent`, `--win` / `--loss` / `--draw`,
  surface levels, text levels). Three themes live behind
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
  matches-set-workspace, match-tags, theme work are the
  canonical patterns: write the e2e against the live UI
  contract (aria-labels, `data-*` attributes, observable DOM
  state), THEN build the component. The unit-test pattern
  (`mountApp(overrides)` in `test-utils/mountApp.ts`) is for
  composable contracts + render branches, not for proving the
  transport chain works.
- **Parent-owned ref bundles** are the shape for cross-view
  state. `MatchesNarrowState` (created in App.vue via
  `createMatchesNarrowState()`, consumed by `useMatchesNarrow`
  and threaded into MatchesView as a single `narrow` prop) is
  the canonical pattern. Refs inside a prop-passed object
  don't auto-unwrap in templates — destructure into top-level
  setup vars on receipt and the templates use them without
  `.value`. `CardStateApi` (`types/cardState.ts`) is the
  earlier example; mirror this shape when you need filter or
  selection state shared across views.
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
  total JS < 270 KB, total CSS < 160 KB. New features that
  push these caps should bump deliberately (with a comment
  explaining why) rather than golf the implementation past
  readability. Substantial modal surfaces should ride on
  `defineAsyncComponent(() => import(...))` so they land in
  their own chunk and stay out of the initial budget — the
  detail panel, screenshot lightbox, and cheatsheet are the
  pattern to mirror. `App.lazy-views.test.ts` is the regression
  guard that fails if someone re-adds a static import.
