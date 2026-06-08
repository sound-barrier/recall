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
- ~~**Reference-data-gaps contextual callout**~~ — first time
  the Unknown tab's Reference data gaps section materialises
  (a record carries an OCR'd `hero_raw` / `map_raw` the parser
  couldn't pin to canonical YAML), Recall surfaces a one-shot
  contextual callout anchored to the section heading explaining
  the wait-for-YAML recovery path. Built on the same
  ContextualCallout primitive PR #235 / #237 / this PR consume.
  Auto-dismisses on Got-it / Esc / close-glyph; persists
  `recall.tour.unknown.refdata.seen=true`.
- ~~**Source-picker contextual callout**~~ — first time the
  Windows 4-card screenshot-source grid renders, Recall surfaces
  a one-shot callout naming the four canonical OW capture
  pipelines so the user doesn't have to guess which card maps
  to their setup. Built on the contextual-callout primitive
  (PR #235). Auto-dismisses on Got-it click, Esc, or picking any
  card; persists `recall.tour.source-picker.seen=true` so it
  never re-fires. Respects the global `recall.onboardingCompleted`
  gate so users who skipped the full tour aren't re-tutorialed.
- ~~**OnboardingTour set-workspace copy rewrite**~~ — the
  matches-dossier / matches-narrow / matches-list / matches-detail
  step copy now leans into the "set workspace" framing: the
  dossier *describes* the active SET, the narrow panel *composes*
  the set by intersecting clauses, leaves are members of the
  set, the detail panel is per-leaf. Targets were already at
  the redesigned class names (.set-dossier / #narrow-popover /
  .leaves-list / aside.detail-panel); this PR is content-only.
  Two more callout surfaces (PRs 7 + 8) wrap up item 13.
- ~~**Reference data gap card → "Fixed in vX.Y.Z" CTA**~~ — the
  Unknown tab's gap-card now surfaces an upgrade tip when the
  upcoming release's `heroes.yaml` / `maps.yaml` already lists
  the OCR'd name. `CheckForUpdate()` extends to fetch both YAML
  assets + their `.sha256` sidecars, verifies the hash before
  parsing, and surfaces the flat name lists as
  `latest_heroes` / `latest_maps`. Tampered or corrupted assets
  drop silently — the card stays on the generic copy. Network /
  sidecar trust model: TLS for transport + SHA verify for
  asset-integrity. SLSA in-toto attestation verification is a
  follow-up — the floor is the published checksum sidecar.
- ~~**Hero × map-type heatmap dossier widget**~~ — opt-in widget
  in the dossier customizer. Rows = top-N most-played heroes in the
  narrowed set; columns = canonical 6 map types (control / escort /
  flashpoint / hybrid / push / clash). Cells coloured by winrate
  bucket (green / amber / red); opacity scales with volume. Clicking
  a populated cell narrows the active set to that (hero, mapType)
  pair via `narrow.pickHero` + `narrow.pickMapType`, so the user
  drills into the matches behind the surface signal without leaving
  the page. Empty-state banner surfaces when decisive matches are
  below a configurable floor (default 20). New `provideNarrow` /
  `useNarrow` injection seam mirrors the dossier seam — the heatmap
  is the first widget that needs to mutate narrow from inside the
  registry.
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

### 1. Leaf-row virtualization (primitive landed; integration deferred)

`MatchesView.vue`'s leaves list renders every visible match's
`<li class="leaf-row">` to the DOM. Fine through ~200 rows; the
existing `useMatchesWindow` composable caps the visible slice at
the pageSize default (~50 rows) until the user clicks "load more"
or "expand to all," so most users never hit the slow path.

A `useVirtualWindow` composable shipped with thorough unit tests
as part of the queue close-out, so when a real perf complaint
surfaces the primitive is ready to wire into the view. Integration
deferred because the touch-points (IntersectionObserver sentinel
for load-more, `j`/`k` keyboard nav over off-screen rows, anchor
scroll, group dividers, click-handler stability across recycled
items) all need to be re-thought in one pass — a half-integration
would regress more than the perf bottleneck saves.

When activating, the integration pass should:

- Replace the `<template v-for="section in windowedSections">`
  body with a `useVirtualWindow`-driven renderer for the
  `groupBy === 'none'` case first; grouped variants stay on the
  existing pagination until uniform-height section dividers ship.
- Preserve the row click handler — bind against the loop variable,
  not derived state, so recycled items dispatch correctly.
- Keep the sentinel-based "load more" pattern intact; this
  composable composes inside it, not as a replacement.

## Polish / lower-priority

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
| Matches workspace | 1, 3, 4, 5, 6, 7, 8 | Dossier + narrow panel are the redesign; remaining items polish the leaves + tag/selection surfaces. |
| Unknown tab | — | Three-section split (Needs review / Unknown maps / Reference data gaps) is the surface; the "fixed in vX.Y.Z" CTA shipped in PR #234. |
| Modals (Detail / Lightbox / Cheatsheet / ExportBundle / IgnoredFiles) | — | The keyboard contract is sound; per-modal items would be premature. |
| First-Run Profile Modal | 14 | Profile naming itself is fine; the inline-picker step is the open work. |
| OnboardingTour + TourCallout + TourSpotlight | — | Set-workspace copy rewrite shipped (PR #236); source-picker + reference-data-gaps contextual callouts shipped (PRs #237 / #238) on the ContextualCallout primitive from PR #235. |
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
