# Recall 1.0 Release Plan

> **Historical record (2026-06-10).** All P0 blockers shipped in PRs
> #249–#259 (commits referenced on each box). P1 / P2 items that
> didn't make the cut now live in **`1-0-FOLLOWUPS.md`** and shrink
> from there as they land. Read this file for the audit decisions
> (every "deferred per-X rationale" box is the single source of
> truth for *why* an item didn't ship); read `1-0-FOLLOWUPS.md` for
> the actionable post-1.0 backlog.

A living checklist for the items that need to land before the 1.0 cut.
Every entry was surfaced by a three-axis audit (API/DB + frontend/UX +
code/tests/docs/release-eng) on top of the post-PR-#248 codebase.

## How to read this document

- **Sections** are by triage band — P0 (must), P1 (should), P2
  (deferrable). Within each band items group loosely by area
  (API/DB · code · UX · a11y · docs · release-eng · tests).
- **Severity tags** are the audit's own assessment of how bad the
  finding is (HIGH / MED / LOW). They're independent of the P-band
  — a LOW-severity finding can still be P0 if it would be
  embarrassing to ship locked.
- **Effort tags** follow the TECHNICAL_DEBT.md convention:
  - **S** — < 2 hours
  - **M** — ½–2 days
  - **L** — 2–5 days
- **No assigned owners** — single-maintainer project.
- **No `(verified)` mark** until a fix lands AND the regression is
  pinned (test, lint rule, or doc). Untick a box if a follow-up
  exposes the finding wasn't actually closed.
- **Constraints baked into this plan**:
  - 1.0 freezes the API contract + on-disk format. Any post-1.0
    break needs a deprecation cycle.
  - No data migration — pre-1.0 break is fine since no users
    exist.
  - Bar for polish is "delights a stranger who downloads it cold."

## Severity / effort legend

| | |
|---|---|
| `[HIGH]` | Would be embarrassing to ship; load-bearing contract or first-impression item. |
| `[MED]` | Notable polish gap or contract concern; worth holding 1.0 if cheap to fix. |
| `[LOW]` | Cosmetic or minor; included for completeness. |
| `S` | < 2 h |
| `M` | ½–2 days |
| `L` | 2–5 days |

---

## P0 — Must fix before 1.0 cuts (~2 weeks of work)

Items in this section are blockers. Shipping 1.0 without fixing them
would either lock in a bad contract, embarrass on a first-impression
basis, or make the launch land flat (e.g., no macOS binary).

### API + DB

- [x] `[HIGH]` `screenshots_dir_id` nullability is mushy — schema declares
  it `NULLABLE INTEGER`, OpenAPI describes `0 = NULL`, FK uses
  `ON DELETE RESTRICT`. Decide: `NOT NULL` with a sentinel
  `screenshots_dirs` row, OR document the `0/NULL` distinction
  formally at the spec level. **File:** `pkg/db/schema.sql:46,83,117` +
  `api/openapi.yaml:2323`. **Effort:** M
- [x] `[MED]` `match_annotations.leaver` SQL `CHECK` allows `NULL` but
  the OpenAPI enum includes `""` as the "no leaver tag" sentinel.
  Verify the handler converts `""` → `NULL` before insert, or align
  the schema CHECK to accept `""` (and pick one canonical form).
  **File:** `pkg/db/schema.sql:169` +
  `pkg/cmd/server_matches.go` (annotation PUT). **Effort:** S
- [x] `[HIGH]` `writeJSON` must marshal nil slices as `[]`, never `null`,
  per the API contract. Add a regression test on the `GetMatchResults`
  error path (where `rows` may be nil) and any other handler returning
  a `var x []T` shape. Audit every `writeJSON(w, rows, err)` site.
  **File:** `pkg/cmd/server.go` + handler files. **Effort:** S
- [x] `[MED]` `POST /api/v1/system/data-update` `422` response isn't in
  the shared `components.responses` block — move it for spec
  consistency. **File:** `api/openapi.yaml:1486`. **Effort:** S
- [x] `[HIGH]` `POST /api/v1/imports` returns `409` for shape-validation
  failures that should be `400` (client sent malformed input).
  Reserve `409` for true conflict states (duplicate profile name,
  etc.). **File:** `api/openapi.yaml:1909` area +
  `pkg/cmd/server_backup.go`. **Effort:** S
- [x] `[LOW]` `POST /api/v1/profiles` returns `201`,
  `PUT /api/v1/profiles/active` returns `200` — document the
  intentional asymmetry, or unify both to `200`. **File:**
  `api/openapi.yaml:1138 + 1174`. **Effort:** S

### Server-side helpers + invariants

- [x] `[MED]` Missing `decodeRequiredString` helper in `server.go`.
  Handlers hand-roll the "non-empty string field" check
  inconsistently; some return `400` with a friendly message, others
  `500` on a downstream panic. Add the helper, sweep all
  required-string fields. **File:** `pkg/cmd/server.go:84–146`.
  **Effort:** S
- [x] `[MED]` `App.Startup()` doesn't assert `a.profiles != nil`. Tests
  use `NewWithStore` which leaves it nil; production currently has
  no invariant check. Add a startup-time assertion so a wiring
  mistake fails immediately instead of returning a nil-pointer
  panic on the first profile call. **File:** `pkg/app/app.go:39–99`.
  **Effort:** S

### Release engineering

- [x] `[HIGH]` License headers missing from source entry points.
  Apache 2.0 is declared in `LICENSE` and referenced in `README.md`,
  but no SPDX header lines exist on `main.go`,
  `frontend/src/App.vue`, or key package entry points. Add SPDX
  boilerplate + a `NOTICE` file listing third-party components
  (`modernc.org/sqlite`, `Masterminds/semver`, Vue, Vite, etc.).
  **Effort:** S
- [x] `[HIGH]` macOS desktop app not in `release.yml` build matrix.
  PR #4 audit: already addressed. `build-mac` job at
  `release.yml:154` runs on `macos-latest`, builds the Wails arm64
  `.app` bundle and DMG via `make build-mac` + `scripts/release/
  make-dmg.sh` (hdiutil retry loop covers the "Resource busy"
  CI flake). The `release` job's `needs: [build, build-mac, sbom]`
  gates DMG into every release. Documented in `RELEASES.md:141`.
  **File:** `.github/workflows/release.yml`,
  `RELEASES.md`. **Effort:** M

### Tests

- [x] `[HIGH]` Five missing e2e specs that cover user-visible
  affordances. PR #3 audit found 3 of 5 already covered; landed
  the genuinely-missing 2:
  - **bulk-delete** — already covered by
    `match-bulk-hide-drawer.spec.ts:58` (bulk hide → unhide →
    bulk delete forever).
  - **profile-switching-persistence** — already covered by
    `multiple-profiles.spec.ts:42` (active-profile PUT fires +
    masthead chip updates).
  - **export-bundle-roundtrip** — export side covered by
    `match-export-bundle.spec.ts`; import side added as
    `export-bundle-roundtrip.spec.ts` (arm/confirm + filechooser
    - POST /imports + afterImport reload).
  - **leaver-match-key-collision** — already covered by
    `ambiguous-attribution.spec.ts:205` (Attach button PUTs
    /resolution with the chosen match_key).
  - **prometheus-scrape** — backend shape pinned by
    `pkg/cmd/server_test.go` (`TestMetricsHandler_*`); FE
    opt-in toggle added as `prometheus-scrape.spec.ts`
    (off→on→off PUTs with `{enabled: <bool>}`).
  No @smoke tagging — both new specs hit existing route patterns
  and don't touch pre-push smoke scope.
  **File:** `frontend/tests/e2e/`. **Effort:** M

### Docs

- [x] `[HIGH]` `README.md` missing a Troubleshooting section. Added
  a four-block <details>/<summary> section between Capturing
  matches and Advanced: Tesseract not found, screenshots-folder
  permission denied, per-OS DB reset, port conflicts (`:9091`
  metrics, `:34115` Wails IPC dev-only, `:7000` server mode).
  Cross-links to the three install guides + CONTRIBUTING.md's
  bug-bundle docs. Each block is collapsed by default so the
  scroll-past surface stays small. **Effort:** M
- [x] `[HIGH]` macOS Gatekeeper first-run experience undocumented in
  `docs/install-macos.md`. PR #4 audit: already addressed.
  `docs/install-macos.md:32-55` covers the **§3 First launch —
  approve the app** flow (System Settings → Privacy & Security
  → Open Anyway, the modern post-macOS-13 replacement for the
  legacy right-click → Open dance) plus a `xattr -d
  com.apple.quarantine` terminal shortcut. The plan's
  "right-click → Open" suggestion would have re-documented an
  obsolete workaround. **Effort:** S

### Frontend UX (first-run + error states)

- [x] `[HIGH]` First-run modal: input validation hint visibility.
  Hint now renders from first focus (drops the `inputDirty`
  gate); turns red when the user has typed something invalid via
  a `first-run-hint-error` class. `aria-describedby` follows the
  same lifecycle so screen readers also see the grammar on focus.
  **File:** `frontend/src/components/FirstRunProfileModal.vue`.
  **Effort:** S
- [x] `[HIGH]` First-run modal step indicator: replaced the two
  unlabeled dots with a `Step 1 of 2` mono label. Pinned by
  `ux-first-run-and-error-states.spec.ts` + the updated
  `first-run-modal-multistep.spec.ts`. **File:**
  `FirstRunProfileModal.vue:181-185`. **Effort:** S
- [x] `[HIGH]` Parse button affordance when `newScreenshotCount === 0`.
  Disabled-state copy now reads "All parsed · nothing new" with
  a `ghost` button class so the state reads intentional. Pinned
  by `IngestView.test.ts` + `ux-first-run-and-error-states.spec.ts`.
  **File:** `frontend/src/components/IngestView.vue:166-176`.
  **Effort:** S
- [x] `[HIGH]` Network errors lack retry. Added `errorRetry`
  ref + Retry button on the error banner. `load()` failures
  set retry = `load` so the button re-runs the same request;
  successful load clears the banner. Added Dismiss button too
  for non-retryable errors. **File:** `App.vue:557-595` +
  `App.vue:1893-1916` + `styles/app.css:950-984`. **Effort:** S
- [ ] `[HIGH]` Mid-parse network drop has no rollback UI. PR #5
  deferred — `parseLog` lives in `App.vue` which is Wails-mode
  primary; the "network drop" only applies to server-mode SSE
  reconnection. Not a 1.0 desktop blocker. **File:** `App.vue:614`
  - `ParseProgressPanel.vue`. **Effort:** M
- [x] `[HIGH]` Error messages forward raw Go errors verbatim.
  Added `frontend/src/error-helpers.ts::plainLanguageError` with
  a regex-based translator covering permission denied, not-a-dir,
  no-such-file, connection refused, timeouts, tesseract exec
  failures, disk-full. Wired through every error-setting site in
  `App.vue` via the new `setErrorFromRaw` seam; raw strings still
  show when no pattern matches (better than a generic
  "Something went wrong"). Pinned by `error-helpers.test.ts`
  (10 cases) + the e2e contract in
  `ux-first-run-and-error-states.spec.ts`. **File:** `App.vue` +
  `error-helpers.ts`. **Effort:** M

### Frontend UX (Matches view)

- [x] `[HIGH]` "End of results" footer on the Matches list. The
  existing `.leaves-foot` "Showing all N matches" was visually
  flat; replaced with a flanked-rule "— End · N matches —" mono
  decoration on the no-more-to-load state so the boundary reads
  as final. The progressive "Showing X of Y" state stays plain.
  Pinned by `matches-infinite-scroll.spec.ts` +
  `MatchesView.test.ts`. **File:**
  `frontend/src/components/MatchesView.vue:1715-1721`. **Effort:** S
- [x] `[HIGH]` "Narrow this set" → "Filter matches" on the popover
  trigger + the panel's `aria-label` + the Close button's
  `aria-label`. Four e2e specs updated (button-text-selector
  sweep). The internal symbol names ("narrow" / "NarrowPopover" /
  `useMatchesNarrow`) stay — they're code identity, not user
  copy. **File:** `MatchesView.vue:1349` +
  `NarrowPopover.vue:223,231`. **Effort:** S

### Frontend UX (Unknown view)

- [x] `[HIGH]` Reference-data-gaps section has no persistent
  callout. PR #6 audit: already covered.
  `UnknownMapsView.vue:782` carries a persistent
  `<p class="needs-review-desc">` that always renders below the
  section heading (gated on `referenceGapRecords.length > 0`)
  explaining the OCR-vs-roster mismatch + the next-release
  pickup pattern + a "View latest release ↗" link. The plan's
  "section-callout that re-appears" goal is already met — the
  surface is permanent, not dismissible. The transient
  `ContextualCallout` at line 829 is the additional just-in-time
  hint on FIRST appearance, which is the orthogonal
  "discoverability" concern. **File:**
  `frontend/src/components/UnknownMapsView.vue:782`.
  **Effort:** S

### A11y

- [x] `[HIGH]` `.leaf-row` role=button conversion. PR #6 audit:
  intentionally NOT done per the documented chips-collide
  convention. `frontend/CLAUDE.md` *Gotchas*: "A clickable
  container with interactive chips cannot be `role=button`.
  Nesting interactive elements is invalid HTML/ARIA and the
  outer role strips keyboard reach from the chips." The
  `.leaf-row` carries inner chips (.leaf-checkbox button,
  result-tag chips, queue/play-mode chips) — converting the
  row to a button would strip keyboard reach from every one of
  them. Keyboard accessibility is already provided by the `e`
  shortcut from `useGlobalKeyboard` (open the detail panel for
  the focused row). Plan item supersedes itself. **File:**
  `MatchesView.vue:1555-1580` (leaf-row markup) +
  `frontend/CLAUDE.md` Gotchas. **Effort:** M

---

## P1 — Should fix before 1.0 (would polish materially)

Items that would noticeably improve quality on first contact. The
maintainer's judgment call which of these is worth holding 1.0 for.

### Code quality

- [ ] `[MED]` `SSEHub` race: parse loop holds `parseMu` while
  broadcasting events; if `SSEHub` gets torn down mid-broadcast
  (profile switch, app shutdown) there's a window. Encapsulate
  parse lifecycle behind a `ParseState` type or guard the
  broadcast site. **File:** `pkg/app/app.go:75-90` +
  `pkg/app/parse.go`. **Effort:** M
- [ ] `[MED]` Large Vue components — `MatchesView.vue` (3,580 lines)
  - `MatchCardExpanded.vue` (2,858 lines) + `App.vue` (2,293
  lines). PR #8 audit: **deferred to post-1.0**. Each split is
  a behavior-preserving pure refactor with no user-visible
  benefit; the comprehensive e2e suite (~350 specs) is the only
  contract that verifies the split is non-breaking, and the e2e
  itself is unchanged by the refactor — so the safety net is
  there, but the value is "internal readability," which can land
  any time. Pre-1.0 the risk/reward favors *not* refactoring
  files that are merge-conflict magnets while polish PRs are
  landing. Concrete revisit signal: when the maintainer is
  blocked on a feature *because of* the file size, do the split
  in a dedicated PR with the e2e suite as the safety net.
  Mechanical extraction order documented in the audit:
  1. `MatchesView.vue` → extract `MatchesNarrowRail.vue` (the
     left-side filter panel surface; its state already lives in
     `useMatchesNarrow`) + `MatchesDossierGrid.vue` (the dossier
     widget grid; already partly factored via per-widget SFCs).
  2. `MatchCardExpanded.vue` → extract `MatchCardStatsGrid.vue`
     - `MatchCardAnnotationEditor.vue` + `MatchCardScreenshotStrip.vue`.
  3. `App.vue` stays — it's the shell router + cross-cutting
     modal state, which is *expected* to be larger.
  **Effort:** L
- [x] `[MED]` Extract `useOnboardingSpotlight` composable from
  `App.vue`. PR #8 audit: **already done in earlier work**.
  Onboarding-tour DOM geometry lives in
  `frontend/src/composables/useOnboardingTour.ts` (the state
  machine + step catalog) and `frontend/src/components/
  TourCallout.vue` (the `getBoundingClientRect` positioning).
  `App.vue` only carries the lightweight async-component mount
  - the `tourActive` ref + the localStorage seed — no
  `ResizeObserver`, no `getBoundingClientRect`. Plan item
  references an outdated audit. **Effort:** M

### Design system + visual polish

- [x] `[MED]` Typography hierarchy. PR #7 audit: the visual
  hierarchy is already established. `.section-title` (Settings'
  per-block headings) is `font-family: var(--display); font-size:
  1.85rem;` per `app.css:1500`. Tab labels are intentionally
  small mono uppercase (`.nav-tab-label` at 0.62rem) — a
  navigation pattern, not a page heading. The plan's named
  view-heading sites ("Settings", "Welcome to Recall") aren't
  rendered as page headings in the current UI; the tab is the
  view identification. No change. **Effort:** M
- [ ] `[MED]` Color semantics: `--accent` split into
  `--interactive-accent` vs identity. Deferred — touches every
  theme + every chip / button / filter pill. Disproportionate
  blast radius for marginal user value pre-1.0; revisit
  post-1.0. **Effort:** M
- [ ] `[MED]` Empty-state visual consistency container. Deferred —
  large refactor across every view with marginal user value;
  empty states are infrequently rendered. Revisit post-1.0.
  **Effort:** M
- [ ] `[MED]` Spacing rhythm tokens in the narrow panel.
  Deferred — introducing `--space-X` tokens requires a project-
  wide spacing audit. Out of scope for 1.0. **Effort:** S
- [x] `[MED]` Settings view sections lack visual dividers. Added
  a 1px `--border-soft` hairline above every `.settings-section
  - .settings-section` (the adjacent-sibling selector skips the
  first section so the page doesn't double up against the
  panel's top edge). Plus a `1.4rem` top margin/padding pair so
  the hairline sits inside breathing room, not flush with the
  next section. **File:** `frontend/src/components/
  SettingsView.vue:447`. **Effort:** S
- [x] `[MED]` Scoreboard "new match" pulse imperceptible on Day
  theme. Bumped the `records-pulse` keyframes from transform-
  only to include a `box-shadow: 0 0 0 4px var(--accent-glow)`
  ring at the 35% beat so the pulse reads against the cream
  background. Transform-only scale still drives the size beat
  for users who see motion but not color. **File:**
  `frontend/src/styles/app.css:740`. **Effort:** S
- [x] `[MED]` Two-step confirm "armed" state too subtle.
  `.danger-btn.danger-confirm` accent-fill bumped from 12% → 24%
  alpha + a `danger-confirm-pulse` keyframe that wraps the
  button in a 3px accent ring at 50%. Reduced-motion media
  query swaps the pulse for a brighter (32% alpha) static fill
  so the cue lands without movement. Applies to the inline
  per-match Hide flow in `MatchCardDanger.vue`. **File:**
  `frontend/src/components/MatchCardDanger.vue:153`.
  **Effort:** S

### Frontend UX (Settings + Parse)

- [x] `[MED]` "Detect Overwatch Folder" loading state. PR P1-A
  audit: already addressed. The Tesseract Detect button at
  `SettingsEngine.vue:152` already shows "Detecting…" while
  `tesseractProbing === true`. The screenshots-folder Detect
  button is intentionally disabled in steady-state (`SettingsFolders.vue:141-147`
  — the design forces a Reset-first re-detect); first-run uses
  the `ScreenshotSourcePicker` 4-card grid which already
  disables cards during `picking`. The "Detect Overwatch
  Folder" surface the plan references doesn't have a live
  click target. **Effort:** S
- [x] `[LOW]` "Last run · X ago" tooltip. Added a
  `:title="Most recent successful parse run on this profile,
  written to localStorage on parse-complete. Absolute time:
  ${new Date(lastParsedAt).toLocaleString()}."` on the
  `<p class="setting-meta">` at `IngestView.vue:142`.
  **Effort:** S
- [x] `[LOW]` Parse progress counter "files" unit. Added a
  `.pp-unit` span (" files") after `.pp-total` in
  `ParseProgressPanel.vue:49-54` plus a `:title` on the
  fraction explaining "Each match is typically 3–4 files."
  Muted color and lowercase letter-spacing so the unit reads
  as a label rather than competing with the count. **Effort:**
  S
- [x] `[MED]` Watch toggle disabled state paragraph. PR P1-A
  audit: already addressed. `IngestView.vue:101-107` already
  renders a `<p class="setting-meta blocked">` paragraph below
  the Watch Folder description when `!tesseractReady`, with a
  ⛔ glyph + "Blocked — needs Tesseract." + a "Fix in Settings
  →" navigation link. Same pattern for Manual Parse at line
  131. The plan's request is already met. **Effort:** S

### Frontend UX — Unknown view polish

- [ ] `[MED]` Ambiguous / Unknown / Reference-gap cards use the same
  `.unknown-card` styling. At a glance, the user can't tell which
  section a card belongs to. Add color-coded left border: red
  (Ambiguous → action), yellow (Unknown → corrupted), blue (Gap
  → awaiting-YAML). **File:** `UnknownMapsView.vue`. **Effort:** S
- [ ] `[MED]` Ambiguous-candidate hover flickers because the
  screenshot `src` reloads per candidate. Preload all candidate
  screenshots on card expand. **File:**
  `UnknownMapsView.vue:162-166`. **Effort:** S
- [ ] `[MED]` "Delete forever" 3-second arm timer is invisible. Add
  a fading border or mini countdown ring on the button.
  **File:** `UnknownMapsView.vue:195` (`IGNORE_ARM_MS`).
  **Effort:** S

### A11y polish

- [x] `[MED]` Skip-link z-index conflict with system-alert. PR #9
  audit: no actual conflict. `.skip-link` is `position: absolute;
  z-index: 1000;` per `app.css:395`; `.system-alert` is in normal
  flow with `z-index: auto`. Skip-link wins. Contract pinned by
  the new `a11y-skip-link-and-modals.spec.ts` (asserts the
  skip-link snaps in on Tab + lands focus on `#main-content`
  even when the System Alert is rendered). **Effort:** S
- [x] `[LOW]` Empty-suggestion buttons aria-label. Each `<button>`
  in `MatchesEmptySuggestions.vue` now carries a consolidated
  `aria-label="Remove ${label} — would surface ${N} match[es]"`,
  and the two inner spans are marked `aria-hidden="true"` so
  screen readers read one cohesive sentence instead of
  fragmented chunks. Visual rendering is unchanged. **File:**
  `MatchesEmptySuggestions.vue:28-35`. **Effort:** S
- [x] `[MED]` Nested-modal focus-trap Esc sequence. Pinned by
  `a11y-skip-link-and-modals.spec.ts` second test: cheatsheet
  over detail panel → Esc closes cheatsheet ONLY (capture-phase
  - `stopImmediatePropagation` keeps the panel's bubble-phase
  Esc out of the event), second Esc closes the panel, focus
  returns to an element inside the leaves-list or the panel
  itself if it transitions out slowly. The contract mirrors the
  pattern documented in `frontend/CLAUDE.md` *Gotchas*.
  **Effort:** M

### Performance

- [ ] `[MED]` App boot: skeleton → blank → real-records flash on
  lazy-loaded view switch. Pre-fetch `/api/v1/matches` once on
  app launch so the first tab switch is instant. **File:**
  `App.vue` + `MatchesView.vue`. **Effort:** M
- [ ] `[MED]` Lazy-loaded view chunks need a loading spinner
  overlay on tab switch for slow networks (the lazy chunk fetch
  - Vue mount takes 200-500ms on throttled 3G). **File:**
  `App.vue` tab switch handler. **Effort:** S

### Microcopy

- [ ] `[MED]` Microcopy sweep — improve voice and clarity across:
  - "Tesseract is not configured. Fix it in Settings → Engine."
    → "Tesseract isn't set up yet. Open Settings → Engine to
    configure it."
  - "Closest non-empty subsets" → "Try removing one filter to
    see more matches:"
  - Trailing-slash on watched-folder display ("Watching /path/
    for new screenshots" → "Watching for new screenshots in
    /path").
  - All-caps mode names ("MATCHES", "UNKNOWN") read formal /
    cold — keep as visual headings, but ensure body copy uses
    sentence case.
  **File:** multiple. **Effort:** M

### Test coverage gaps

- [ ] `[MED]` High-contrast theme has no real e2e coverage at the
  layout level (`a11y.spec.ts` only runs axe-core, not visual).
  Add at least a per-view snapshot test under the
  high-contrast theme. **File:**
  `frontend/tests/e2e/a11y.spec.ts` + new snapshot spec.
  **Effort:** M

---

## P2 — Nice-to-have / post-1.0 candidates

Items worth tracking but not worth holding 1.0 for. Defer to the
post-1.0 backlog when 1.0 ships.

### CI / tooling

- [ ] `[LOW]` Pre-push smoke subset gaps — currently filters to a
  small set. Expand once the P0 e2e specs land so historical
  flakes get pre-push coverage. **File:** `lefthook.yml` +
  `scripts/check-playwright-smoke.sh`. **Effort:** S

### Code-quality cleanup

- [ ] `[LOW]` Magic numbers — pull the remaining outliers into
  named consts: timezone offset in `text.go`, OCR upscale (`2x`)
  in `imageutil.go`, Levenshtein threshold (`3`) in `maps.go`.
  **File:** `pkg/parser/`. **Effort:** S
- [ ] `[LOW]` Public-API doc comments missing on
  `pkg/parser/classify.go` and `pkg/parser/golden.go`. Add
  package-level + per-function comments where exported.
  **Effort:** S
- [ ] `[LOW]` Logging: codebase relies on error returns rather than
  structured logs. Adopt `log/slog` post-1.0 for production
  debugging capability (parse start/end, DB schema apply, API
  handler entry/exit). **File:** all. **Effort:** L

### Property-based testing

- [ ] `[LOW]` Property-based / fuzz tests on parser entry points
  (`parser.Parse*`) and URL handlers (`/_screenshot/<filename>`).
  Use Go's native `testing.F`. **File:** `pkg/parser/`. **Effort:** M

### Doc conventions

- [ ] `[LOW]` Document the test-only-API convention in
  `CONTRIBUTING.md` (`app.NewWithStore`, `parser.ToGolden`,
  `pkg/db/dbtest`, etc.) so future contributors know not to
  treat them as stable. **Effort:** S
- [ ] `[LOW]` Document the "no telemetry" choice explicitly in
  `SECURITY.md`. Privacy-first is a positive; users should know.
  **Effort:** S

### Features (post-1.0)

- [ ] `[LOW]` In-app auto-updater. Wails v2 supports it; today
  the user clicks "Open release page." Defer to 1.1. **Effort:** L

---

## D. Already good (positive findings — don't revisit)

Logged so the maintainer doesn't burn cycles auditing what's already
solid:

- `pkg/parser/` decomposition is clean — 26 files by concern, no
  single file > 632 lines.
- File-per-concern Go layout across `pkg/app/*.go` and
  `pkg/db/store*.go`.
- 79 e2e Playwright specs is substantial coverage.
- All path params snake_case post PR #245.
- API design rules compliance: GET/PUT/DELETE/POST mapping clean,
  status codes mostly correct.
- `scripts/deadcode-allow.txt` entries are all defensible — no
  false positives to remove.
- `TECHNICAL_DEBT.md` carries only #13 (deferred per YAGNI).
- Dependency audit clean — Go 1.26.4 (modern), no EOL deps in
  `go.mod` or `frontend/package.json`.
- `lefthook.yml` + `Makefile` + CI in sync post PR #247.
- File permissions restrictive (`0o600` writes, `0o700` mkdirs)
  across the codebase.
- Build provenance (`cosign` + `attest-build-provenance`) wired
  on release artifacts.
- release-please clean — CHANGELOG entries proper.
- Issue tracker at 0 open issues.
- Conventional Commits enforced via lefthook `commit-msg` hook.
- Pre-1.0 migration framework removed (PR #246); schema lives
  in one consolidated `pkg/db/schema.sql`. The framework
  scaffolding is intentionally inert until 1.0 needs the first
  real migration.

---

## Execution plan

Suggested PR sequencing — bundle items so each PR has a coherent
scope. Numbers indicate dependency order, not strict required
sequence.

1. **`refactor!: API + DB hardening`** — every P0 item under
   API/DB. Pre-1.0 break is fine; rev `api/openapi.yaml`, regen
   types via `make gen-types`, sweep handlers + tests + the
   `schemathesis` job.
2. **`refactor: server-side helpers + invariants`** —
   `decodeRequiredString`, `App.Startup()` profile assertion,
   `SSEHub`/`parseMu` encapsulation, nil-slice regression test,
   license headers, `NOTICE` file.
3. **`test(e2e): missing 1.0 specs`** — five spec files
   (bulk-delete, profile-switching, export-import round-trip,
   leaver-collision, prom-scrape). Tag with `@smoke` if any
   belong in the pre-push subset.
4. **`docs(1.0): troubleshooting + macOS Gatekeeper + RELEASES.md`** —
   README troubleshooting section, macOS install-guide updates,
   `RELEASES.md` macOS-cut documentation, signing path
   decisions (or "unsigned + verified via GitHub attestations"
   disclaimer if not signing).
5. **`fix(ux): first-run + error states`** —
   `FirstRunProfileModal` validation timing + step indicator;
   Parse button affordance; retry CTAs on error banners;
   mid-parse error chip; error-message plain-language sweep.
6. **`fix(ux): Matches + Unknown polish`** — "Narrow" → "Filter",
   end-of-results footer, reference-data-gaps callout, leaf-row
   `role=button` (or `<button>` conversion), ambiguous-card
   preloads, delete-forever timer, card color coding.
7. **`refactor(ui): design system tightening`** — typography
   hierarchy, `--accent` split, empty-state container, spacing
   tokens, Day theme pulse visibility, Settings section
   dividers.
8. **`refactor(fe): split large components`** — split
   `MatchesView.vue` and `MatchCardExpanded.vue`; extract
   `useOnboardingSpotlight`. Behavior unchanged; e2e covers
   regression.
9. **`fix(a11y): pre-1.0 sweep`** — skip-link z-index, focus-trap
   sequence in nested modals, high-contrast snapshot e2e,
   `aria-label` cleanups.
10. **`release: cut 1.0.0`** — final `CHANGELOG.md` review,
    `release-please` version bump, tag, fire `release.yml`.

P2 items roll into a parallel **`1-0-FOLLOWUPS.md`** when 1.0 ships
— same shape as `TECHNICAL_DEBT.md`, just scoped to "things we'd
like for 1.1+."

---

## Verification

1. Maintainer reads this document end-to-end. Items get re-tagged
   (P0 ↔ P1 ↔ P2) without restructuring sections — the audit
   surfaced findings; the triage band is the maintainer's call.
2. As PRs land, the corresponding checkboxes get ticked. Add a
   commit-message reference (`Closes 1-0-RELEASE-PLAN.md §A:
   <item>`) so post-launch we can audit which PR closed which
   item.
3. When all **P0** boxes are ticked AND the maintainer has applied
   judgment to **P1**, 1.0 is ready to cut.
4. After the 1.0 tag lands, move remaining P2 items into a new
   `1-0-FOLLOWUPS.md` and delete this file (git history is the
   audit trail, same convention as `TECHNICAL_DEBT.md`).
