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
- ~~**Leaf-row virtualization (flat mode)**~~ — when the user
  switches `groupBy` to `none`, `MatchesView` now renders only
  the in-viewport slice of the leaves list via the new
  `useVirtualWindow` composable in `mode: 'window'`. Spacer
  divs above + below the rendered slice keep the document
  scrollbar honest; auto-scroll-into-view brings off-screen
  rows to focus when the j/k keyboard nav advances past the
  rendered window. Grouped modes (day / week / month / year)
  keep today's pagination — mixed-height section dividers need
  a separate model and ship later if a perf complaint
  materialises. Verified with a 1000-record fixture: < 60
  `.leaf-row` DOM elements at any scroll position.
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
- ~~**Steam in-game F12 screenshot filename support**~~ — commit
  `03b5291`. Adds the fourth canonical capture source —
  `YYYYMMDDHHMMSS_N.jpg` (where `_N` is the monitor index on
  multi-monitor rigs). The Settings → 01 Directories picker grid's
  Steam tile (PR #226) was already in place; this commit closes
  the parser side. Same trust shape as the other three:
  per-source prefix gate + anchored regex + RFC3339 round-trip
  validation.
- ~~**Check for updates modal + 90-day reminder banner + Apply Data
  Update flow**~~ — commit `afb7e24`. Replaces the silent
  on-mount update poll + masthead in-button state machine with a
  user-triggered modal. Click **Check for updates** in the
  masthead → modal opens with two sections: **Recall app** (current
  vs latest binary version + release-notes excerpt + "Open release
  page" link) and **Game data** (per-roster diff with an Apply
  button). Apply downloads the release's
  `recall-<v>-{heroes,maps,screenshot_sources}.yaml` + SHA-256
  sidecars, verifies, atomically writes under
  `<RECALL_DATA_DIR>/data/`, and triggers a parser reload — new
  heroes/maps/sources land without a binary upgrade. A 90-day
  "haven't checked in a while" reminder banner sits between the
  System Alert and the tab nav so a quiet install gets nudged.
  Modal is focus-trapped (Esc closes, returns focus to trigger);
  the reminder banner uses `role="status"` + dismiss-for-current-
  cycle via `usePersistedRef`.
- ~~**Live-from-main YAML channel + Sync from main button**~~ —
  commit `4658c55`. Adds a second sub-row to the modal's Game
  data section: **Main** publishes the three YAMLs + per-file
  `.sha256` sidecars + `version.json` to
  `https://sound-barrier.github.io/recall/data/` on every push to
  `main` that touches `pkg/parser/*.yaml`. Users on stable
  binaries can opt in to bleeding-edge rosters via **Sync from
  main**, independent of the Recall release cadence. Row hides
  itself when Pages is unreachable (the FE reads `main.commit_sha`
  as the gate). Manifest tracks `applied_source` ("release" |
  "main") + `applied_main_commit` so subsequent checks can show
  "Applied main @ abc1234 · 2 days ago".

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

## June 2026 page-by-page audit — closing snapshot

The 14-item backlog that came out of walking every surface
end-to-end against `main` (post-PR-#227) has fully shipped — every
item from the original audit now lives struck-through under
**Recently shipped** above. Two further user-visible feature waves
landed after the audit closed (Updates flow, Steam F12 source) and
get their own rows below so this ledger stays a complete map of the
current UX surface.

| Surface | Status | PR / commit | Notes |
|---|---|---|---|
| Settings → 01 Directories (picker grid) | ✓ shipped | #226 + #237 (callout) | 4-card grid (Nvidia / OW PrntScn / Win Snip / Steam install) with per-card status dots + folder-walk diagnostics + first-run contextual callout. |
| Settings → 02 Engine (Tesseract) | — | — | No change since June; row UX matches the docs shape. |
| Settings → 03 Appearance (theme) | — | — | Four-theme set (day / dark / night / high-contrast); chooser is intentionally minimal. |
| Settings → 04 Calendar (week start) | — | — | Seven-cell grid + caption already resolves the two-T / two-S ambiguity. |
| Settings → 05 Backup & Restore | — | — | Two-step confirm pattern is sound. |
| Settings → 06 Advanced (Stream / Clear / Re-parse / Formats) | ✓ shipped | #224 (re-parse) + #227 (multi-format) | Re-parse-all-screenshots + the multi-format support landed; format list reads from `parser.Sources()` so a new yaml entry shows up without code. |
| Parse tab | — | — | Run Parse + Watch Folder match the docs intent. |
| Matches workspace | ✓ shipped | #239 (heatmap widget) + #240 (virtualization) | Hero × map-type heatmap dossier widget + leaf-row virtualization for flat mode. Mixed-height grouped modes (Y / M / W / D) keep pagination — virtualization there ships only on a real perf complaint. |
| Unknown tab | ✓ shipped | #234 (Fixed-in CTA) + #238 (refdata callout) | Three-section split (Needs review / Unknown maps / Reference data gaps) + gap-card "Fixed in vX.Y.Z" CTA + first-materialisation contextual callout. |
| Modals (Detail / Lightbox / Cheatsheet / ExportBundle / IgnoredFiles) | — | — | Keyboard contract is sound; no per-modal items materialised. |
| First-Run Profile Modal | ✓ shipped | #228 (inline picker) | Inline source-picker step landed alongside the profile-naming step. |
| OnboardingTour + TourCallout + TourSpotlight | ✓ shipped | #235 / #236 / #237 / #238 | ContextualCallout primitive (#235) + set-workspace copy rewrite (#236) + two callout surfaces. |
| Masthead **Updates flow** (modal + reminder banner) | ✓ shipped (post-audit) | `afb7e24` (modal + banner) + `4658c55` (main channel) | Old version-chip in-button state machine → user-triggered modal with two sections (Recall app + Game data). Game data has Release + Main sub-rows; modal's `commit_sha` empty-string is the gate for hiding the Main row when Pages is unreachable. 90-day "haven't checked in a while" reminder banner sits between the System Alert and the tab nav. |

### Next audit trigger

Re-run the surface walk after any of:

- **`TECHNICAL_DEBT.md` items #1-#5** (REST API spec fixes) —
  particularly #1 (drop `data` + `main` from
  `/api/v1/system/update`'s required array) and #2 (factor
  `DataStatus` + `MainStatus` via `allOf`). The Updates modal's
  FE binding consumes the response shape directly; UX shouldn't
  change but the type wiring does.
- **`TECHNICAL_DEBT.md` item #11** (`screenshots_dirs`
  `ON DELETE SET NULL` orphan-row fix) — reshapes the picker-grid
  lifecycle in Settings → 01 Directories. The current row's
  "shipped" status assumes the directory is pinned for the life of
  the database; if the fix lands with an explicit "forget this
  folder" affordance, the picker UX inherits a new surface.
- **`TECHNICAL_DEBT.md` SQL item #13** (reverse index on
  `match_annotation_members(member)`). Defer-until-feature-lands —
  the conditional in the debt entry says so. If "bulk operations
  by player" lands, the Matches workspace + bulk-action bar get
  fresh audits.

Snapshot the audit's outcome here when those trigger conditions
fire — even an empty audit is the contract that says "nothing to
do, surface-by-surface."

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
