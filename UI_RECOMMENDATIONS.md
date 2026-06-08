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
- ~~**Per-match Quickplay / Competitive + Role Queue / Open Queue
  classification**~~ — three surfaces shipped together
  (PRs #215 / #217 / #218): leaf-row chip pair, detail-panel
  chooser, and narrow-filter Queue + Play mode sections. All three
  read the same canonical bucket via `formatPlayModeLabel` /
  `formatQueueTypeLabel` in `match-helpers.ts`, so leaf ↔ chooser
  ↔ filter agree on every match. "Unknown mode" / "Unknown mode
  type" are first-class filter chips.
- ~~**Bulk-set play-mode + queue from selected rows**~~ — shipped
  in PR #218 alongside the existing Hide / Export / Move bulk
  actions in `BulkActionBar.vue`. Per-row checkboxes tick into
  `selectedKeys`; the sticky bar exposes Set play mode ▾
  (Quickplay / Competitive / Clear) and Set queue ▾ (Role / Open /
  Clear) menus that fire a single `PUT /api/v1/matches/play-mode`
  / `/queue-type` per click — one transaction per click, not N.
  The remaining bullet from this list (Tag, Star, contextual
  surfaces) is now item 3 below.
- ~~**Unknown hero / map detection + Reference data gaps section**~~ —
  PR #224. Parser tightening (length-gated fuzzy Pass-2) +
  `hero_raw` / `map_raw` columns preserve the OCR'd token when a
  match isn't in the canonical YAML. Leaf row gets
  `Unknown hero (miyazaki?)` chip, detail panel gets a striped-
  accent banner above the chooser block linking to the latest
  release page, and the Unknown tab gets a third
  **Reference data gaps** section listing every record awaiting a
  YAML update. Settings → Advanced → **Re-parse all screenshots**
  re-runs Tesseract on the corpus for the one-shot recovery flow.
- ~~**Windows screenshot source picker (4 named sources)**~~ —
  PR #226. Replaces the generic Auto-Detect / Choose Manually CTA
  pair on the first-run empty-state hero with a 2 × 2 grid naming
  Nvidia Overlay / OW PrntScn / Win Snip / Steam install, each
  with a status dot showing path existence. Click a found card →
  one-step set + watcher start. macOS / Linux hide the grid (with
  an `AUTO-DETECT · WINDOWS ONLY` eyebrow) and show only the
  custom-pick button. `ScreenshotSourcePicker.vue` +
  `pkg/app/probe_windows.go` (registry resolver).
- ~~**Multi-format screenshot filename support**~~ — PR #227.
  Parser now recognises Nvidia (`Overwatch 2 Screenshot YYYY.MM.DD
  - HH.MM.SS.ff.png`), OW PrntScn default (`ScreenShot_YY-MM-DD_
  HH-MM-SS-fff.jpg`— note: JPG), and Win Snip
  (`Screenshot YYYY-MM-DD HHMMSS.png`) filename shapes. Per-tool
  prefix gate means random non-OW files in the watched folder are
  silently skipped instead of absorbed.
- ~~**Released-asset attestation for `heroes.yaml` + `maps.yaml`**~~ —
  PR #220. Every release now ships `recall-X.Y.Z-heroes.yaml` and
  `recall-X.Y.Z-maps.yaml` with SLSA build provenance + SHA-256
  sidecars (the sidecars are signed too). Verification:
  `gh attestation verify recall-X.Y.Z-heroes.yaml --repo sound-barrier/recall`.

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

### 9. Per-source diagnostic strip on the picker grid

`ScreenshotSourcePicker.vue` (PR #226) currently shows the four
cards with a single green/gray dot + path. Once the user has
been parsing for a while, the *content* of each candidate
folder is more useful than its mere existence: "Nvidia Overlay
— 47 files, last write 2h ago" / "OW PrntScn — 0 files" /
"Win Snip — 12 files but none look like OW screenshots" tells the
user which source their captures are actually landing in.

- **Where**: an optional second metadata line under each card,
  rendered only when the path exists. The probe handler
  (`ProbeScreenshotsCandidates`) already does the directory
  walk — extend it to return `{file_count: int, last_modified:
  string, recognised_filename_count: int}` per candidate, with
  an upper bound (e.g. count up to 1000 entries) so it stays
  fast on synced cloud folders.
- **Constraint**: don't block the picker render on this — the
  probe has to stay snappy. Stream the metadata in via a
  separate `/screenshots-folder-candidates/stats` endpoint that
  the picker queries after the cards mount.
- **Effort**: ~4 hours. New probe endpoint + per-card
  `useScreenshotFolderStats` composable.

### 10. "Supported filename formats" surface in Settings → Advanced

After PR #227 the parser recognises three filename shapes
(Nvidia, OW PrntScn, Win Snip). There is no in-app way for a
user to see *which* shapes work — they have to guess from the
picker grid's source names + the docs site. A read-only table
under Settings → Advanced ("Supported capture-source rules")
that lists the prefix, regex, and an example filename per
format makes the contract self-documenting.

- **Where**: nested under the Re-parse all screenshots row in
  Settings → Advanced. Closed by default in a
  `<details>`/`<summary>` — power-user surface only.
- **Constraint**: this is the same data that TECHNICAL_DEBT
  item #3 wants to extract into a YAML. If that lands first,
  this surface reads from the YAML directly and a future
  release's added format shows up here automatically.
- **Effort**: ~2 hours. Pure render; no new endpoint until the
  YAML extraction lands.

### 11. Reference data gap card → "Will be fixed in vX.Y.Z" link

The Unknown tab's **Reference data gaps** section (PR #224)
explains the wait-for-YAML recovery path generically but
doesn't tell the user *which* release will add the missing
entry. A small enrichment: when a record is gap-flagged with
`Unknown hero (miyazaki?)`, query the GitHub release feed for
the latest tag and check whether the published `heroes.yaml`
sidecar already contains the entry — if so, surface "Update to
v9.11.0 to recognise `miyazaki`" as a CTA on the card.

- **Constraint**: this is a network read. Cache the latest
  release's `heroes.yaml` + `maps.yaml` SHA + parsed contents
  to disk (TTL ~24h) so the Unknown tab doesn't pin a network
  call. Honour the existing offline-tolerant pattern in
  `UpdateBanner.vue` (the masthead version chip) — if the
  fetch fails, the card stays at its current "wait for the
  next release" copy without a visible error.
- **Constraint**: the fetched YAML sidecars are attested. The
  client should `gh attestation verify` equivalent (parse the
  in-toto attestation, verify the cert chain). The Go side
  already has the verification primitives for the desktop
  app's own download; reuse them.
- **Effort**: ~6 hours including the cache layer + a test
  fixture for the "release adds Miyazaki but not Junkertown"
  partial-match case.

### 12. Re-parse progress: "X of Y matches updated"

Settings → Advanced → **Re-parse all screenshots** (PR #224)
currently shows file-level progress in the masthead Parse
indicator. A user re-parsing because they want to recover
miyazaki gap records doesn't care which file is being
re-OCR'd — they want to know how many of their existing
matches have been *updated*. A second progress line under the
button — "12 of 47 matches updated (3 hero/map fields
corrected)" — tells the actual story.

- **Constraint**: the re-aggregate step already runs after the
  re-OCR completes; instrument it to emit `matches_updated` +
  `hero_corrections` + `map_corrections` counters and stream
  them on the existing Parse SSE channel.
- **Effort**: ~3 hours including the SSE counter additions +
  Settings render.

### 13. OnboardingTour walkthrough for new affordances

`OnboardingTour.vue` + `TourCallout.vue` + `TourSpotlight.vue`
shipped pre-PR-#218 and don't introduce three large surfaces
that landed since:

- **Set workspace** — dossier headline, narrow panel, leaf
  rows. The current tour predates this redesign and lands
  users on the old AggregateStats shape; the spotlight is
  pointing at the wrong region.
- **Screenshot source picker** — first-run Windows users never
  see the 4-card grid explained; they figure it out from the
  card labels alone.
- **Reference data gaps** — the Unknown tab's third section
  only appears once a record carries the signal, so the tour
  can't point at it on first run. The fix: a *contextual*
  callout that fires the first time the section becomes
  non-empty, anchored to the section heading and dismissed
  permanently via a localStorage key (`recall.tour.unknown.refdata.seen`).

- **Constraint**: tour callouts are a strong UI affordance —
  one badly-timed callout will train the user to dismiss them
  reflexively. Cap to one in-flight callout at a time; respect
  a global `tour-dismissed` localStorage gate so power users
  who already dismissed onboarding don't see new callouts
  appearing unannounced.
- **Constraint**: callouts must clear WCAG 2.4.6 (headings &
  labels are descriptive) and 2.4.11 (focus not obscured) —
  the spotlight cutout must not visually hide the focused
  element when keyboard navigation lands on a tour-anchored
  control.
- **Effort**: ~8 hours total — 3h tour copy rewrite for the
  set-workspace surfaces, 2h source-picker callout, 3h
  contextual gap-section callout + persistence.

### 14. First-Run Profile Modal — adopt the new picker surface

`FirstRunProfileModal.vue` is the user's first interaction.
After they name a profile, it hands off to the empty-state
hero on Settings. The picker grid (item shipped above) is
arguably the more impactful "first thing they see" than the
modal's profile-naming step — but the modal still presents
profile naming as the lead. Consider:

- **Inlining the picker** into a second modal step so the
  user picks a screenshot source in the same dialog rather
  than landing on a blank-looking Settings page with a Files
  card. Lower friction; same number of clicks.
- **Constraint**: the modal already has tab-trap + focus
  return semantics. Adding a second step has to preserve
  both, plus the back-navigation between the steps must
  return focus to the field the user was on.
- **Effort**: ~5 hours including the multi-step state machine
  inside the modal + an e2e spec covering the two-step path.

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

## June 2026 page-by-page audit signal

The 14-item backlog above came out of walking every surface
end-to-end against the current `main` (post-PR-#227). The
mapping back to source surfaces:

| Surface | Items raised | Notes |
|---|---|---|
| Settings → 01 Directories (picker grid) | 9, 14 | The 4-card grid is new; per-card diagnostics + first-run inlining are the open work. |
| Settings → 02 Engine (Tesseract) | — | Row UX matches the docs-reference shape; nothing to change. |
| Settings → 03 Appearance (theme) | — | Two-card chooser is intentionally minimal. |
| Settings → 04 Calendar (week start) | — | Seven-cell grid + caption already resolves the two-T/two-S ambiguity. |
| Settings → 05 Backup & Restore | — | Two-step confirm pattern is sound. |
| Settings → 06 Advanced (Stream/Clear/Re-parse) | 10, 12 | Stream-to-Grafana row is fine; the new Re-parse + format-list surfaces want enrichment. |
| Parse tab | — | Run Parse + Watch Folder both match the docs intent. |
| Matches workspace | 1, 2, 3, 4, 5, 6, 7, 8 | Dossier + narrow panel are the redesign; remaining items polish the leaves + tag/selection surfaces. |
| Unknown tab | 11 | Three-section split (Needs review / Unknown maps / Reference data gaps) is the surface; gap cards want the "fixed in vX.Y.Z" CTA. |
| Modals (Detail / Lightbox / Cheatsheet / ExportBundle / IgnoredFiles) | — | The keyboard contract is sound; per-modal items would be premature. |
| First-Run Profile Modal | 14 | Profile naming itself is fine; the inline-picker step is the open work. |
| OnboardingTour + TourCallout + TourSpotlight | 13 | Framework is sound; the *content* is stale and predates the set-workspace redesign + the new picker + the gap section. |
| Masthead (profile chip, theme switcher, update banner) | — | Reasonably mature. |

Re-run this audit before the next round of recommendations
lands — particularly after TECHNICAL_DEBT.md #3 + #4 work,
which will reshape the Settings probe / capture-source surfaces
in ways that may obsolete items 9 + 10.

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
- **Bundle budgets** are CI-enforced
  (`scripts/check-bundle-size.sh`, invoked from `ci.yml`):
  total JS < 422 KB, total CSS < 242 KB (and init-bundle
  guardrails inside the script). Per-PR bumps land deliberately
  with a one-line rationale — see TECHNICAL_DEBT.md item #1 for
  the running history's maintainability problem. Substantial
  modal surfaces should ride on
  `defineAsyncComponent(() => import(...))` so they land in
  their own chunk and stay out of the initial budget — the
  detail panel, screenshot lightbox, and cheatsheet are the
  pattern to mirror. `App.lazy-views.test.ts` is the regression
  guard that fails if someone re-adds a static import.
