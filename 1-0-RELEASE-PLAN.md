# Recall 1.0 Release Plan

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
- [ ] `[HIGH]` macOS desktop app not in `release.yml` build matrix.
  `make build-mac` requires a macOS host and isn't in CI. Either
  wire an Apple Silicon runner (paid Actions) or document the
  manual local cut path in `RELEASES.md`. Shipping 1.0 without a
  macOS binary is the single biggest "embarrass on launch" risk.
  **File:** `.github/workflows/release.yml`,
  `RELEASES.md`. **Effort:** M

### Tests

- [ ] `[HIGH]` Five missing e2e specs that cover user-visible
  affordances. Add them before 1.0:
  - `bulk-delete.spec.ts` — multi-select → bulk delete from
    Matches view.
  - `profile-switching-persistence.spec.ts` — switch profiles
    mid-session, verify state restoration.
  - `export-bundle-roundtrip.spec.ts` — export → re-import,
    verify record count + per-row fidelity.
  - `leaver-match-key-collision.spec.ts` — leaver annotation
    against a match-key collision resolution flow.
  - `prometheus-scrape.spec.ts` — Prometheus endpoint validation
    - Grafana panel refresh shape.
  Tag with `@smoke` if any belong in the pre-push subset.
  **File:** `frontend/tests/e2e/`. **Effort:** M

### Docs

- [ ] `[HIGH]` `README.md` missing a Troubleshooting section. First-run
  failures (Tesseract not found; screenshots-folder permissions
  denied; DB reset steps per-OS; Wails IPC port conflicts) aren't
  surfaced where new users look. Cross-reference
  `docs/install-{macos,linux,windows}.md` + `CONTRIBUTING.md` where
  detailed steps live. **Effort:** M
- [ ] `[HIGH]` macOS Gatekeeper first-run experience undocumented in
  `docs/install-macos.md`. Strangers will see "Recall cannot be
  opened because the developer cannot be verified" and abandon.
  Add a paragraph + a screenshot + the right-click → Open
  workaround. **Effort:** S

### Frontend UX (first-run + error states)

- [ ] `[HIGH]` First-run modal: input validation hint fires after the
  user clicks Next and the button is dead, not on first keystroke.
  Show the hint (a-z / 0-9 / _ / -, 1-40 chars, starts alphanum)
  on first focus so a first-time user knows the rules before
  guessing. **File:**
  `frontend/src/components/FirstRunProfileModal.vue`. **Effort:** S
- [ ] `[HIGH]` First-run modal step indicator (the two dots) is too
  small to read as a progress bar. Make it a `Step 1 of 2` label
  or a real progress bar with clear spacing. **File:**
  `FirstRunProfileModal.vue:181-182`. **Effort:** S
- [ ] `[HIGH]` Parse button affordance when `newScreenshotCount === 0`.
  Button stays enabled, title says "All parsed," clicking does
  nothing visible → user thinks the app is broken. Change the
  disabled-state copy to "All parsed · nothing new" + secondary /
  ghost style so the state reads intentional. **File:**
  `frontend/src/components/IngestView.vue:174`. **Effort:** S
- [ ] `[HIGH]` Network errors lack retry. `load()` catches the
  Promise rejection and shows the error banner with no
  `[Retry]` button → user reloads the whole app. Add a retry CTA
  to the error banner. **File:** `frontend/src/App.vue:523-544`.
  **Effort:** S
- [ ] `[HIGH]` Mid-parse network drop has no rollback UI. `parseLog`
  accumulates partial entries; there's no "Parse aborted,
  retrying…" state. Surface a prominent error chip on the
  progress panel with a Retry. **File:** `App.vue:614` +
  `ParseProgressPanel.vue`. **Effort:** M
- [ ] `[HIGH]` Error messages forward raw Go errors verbatim ("failed
  to stat path /Users/x: permission denied") instead of
  plain-language CTAs. Map common errors (permission, not-found,
  not-a-dir) to "Cannot access X. Check that you have read access
  or try a different folder." **File:** `App.vue` error handlers.
  **Effort:** M

### Frontend UX (Matches view)

- [ ] `[HIGH]` "End of results" footer missing on the Matches
  infinite scroll. A user filtering to 3 records scrolls past
  them into empty space + thinks scroll broke. Add a centered
  `— End of N matches —` mono footer. **File:**
  `frontend/src/components/MatchesView.vue`. **Effort:** S
- [ ] `[HIGH]` "Narrow this set" copy is ambiguous to non-power-users
  ("narrow" → focus? remove? zoom?). Change to "Filter matches"
  or "Search & filter". **File:** `MatchesView.vue:267`.
  **Effort:** S

### Frontend UX (Unknown view)

- [ ] `[HIGH]` Reference-data-gaps section has no persistent callout
  explaining what it means after the first dismissal. A user
  returning to the section after a roster update has no context.
  Add a `.section-callout` that re-appears whenever the section
  is non-empty. **File:**
  `frontend/src/components/UnknownMapsView.vue`. **Effort:** S

### A11y

- [ ] `[HIGH]` `.leaf-row` divs handle `@click` but lack
  `role="button"` (or — preferred — `<button>` conversion).
  Screen readers announce them as plain divs; keyboard focus
  semantics are off. Convert to button or add the role +
  `tabindex` + keyboard handler. **File:** `MatchesView.vue`
  around line 400. **Effort:** M

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
- [ ] `[MED]` Large Vue components past comfortable maintenance size:
  - `MatchesView.vue` — 3,560 lines. Split into
    `MatchesNarrowRail.vue`, `MatchesDossierGrid.vue`, and the
    leaf-list shell.
  - `MatchCardExpanded.vue` — 2,858 lines. Extract stats grid +
    annotation editor + screenshot strip.
  - `App.vue` — 2,243 lines. Some justified (shell + modal
    cross-cutting), but extract the onboarding-tour DOM-geometry
    inline code.
  Improves both readability AND testability — currently only
  e2e exercises the full component. **Effort:** L
- [ ] `[MED]` Extract `useOnboardingSpotlight` composable from
  `App.vue`. The inline DOM geometry (`ResizeObserver` +
  `getBoundingClientRect` for the spotlight mask) doesn't belong
  in the shell router. **File:** `App.vue` →
  `frontend/src/composables/useOnboardingSpotlight.ts`. **Effort:** M

### Design system + visual polish

- [ ] `[MED]` Typography hierarchy: Big Noodle Too display font is
  declared and bundled but only used for in-game hero/map labels.
  View headings ("Settings", "Welcome to Recall") use body font
  and feel undersized for a launch-quality product. Bump
  view-heading sites to the display font or +0.5rem. **File:**
  `frontend/src/styles/app.css` + view SFC heading styles.
  **Effort:** M
- [ ] `[MED]` Color semantics: `--accent` is conflated between
  interactive affordance (active filter chips, button hovers) and
  identity (hero names, OW orange). Split into
  `--interactive-accent` (cooler, slightly muted) vs `--accent`
  (the brand orange) so semantics disambiguate. **File:**
  `app.css`. **Effort:** M
- [ ] `[MED]` Empty-state visual consistency. Each view rolls its own
  empty state with subtly different padding / typography /
  iconography. Introduce a shared `.empty-state-container` (or
  `EmptyState.vue` component) so emptiness reads as intentional
  across the app. **File:** multiple SFCs + `app.css`. **Effort:** M
- [ ] `[MED]` Spacing rhythm in the narrow panel: ad-hoc
  `0.75rem` / `1rem` / `1.5rem` gaps make the panel read as a
  collage. Define `--space-X` tokens (e.g. `--space-3`,
  `--space-4`) or a `.narrow-section-gap` class. **File:**
  `NarrowPopover.vue`. **Effort:** S
- [ ] `[MED]` Settings view sections lack visual dividers between
  Folders / Engine / Appearance / Calendar / Backup. Add a 1px
  `--border-soft` above each section heading to chunk the long
  page. **File:** `SettingsView.vue`. **Effort:** S
- [ ] `[MED]` Scoreboard "new match" pulse animation on the Day
  theme is imperceptible against the cream background. Bump the
  `--accent` opacity in the keyframes (or use a brief border
  glow). **File:** `App.vue` + `app.css` pulse keyframes.
  **Effort:** S
- [ ] `[MED]` Bulk-hide two-step confirm — first-click visual change
  is too subtle to read as "armed". Give the "Confirm?" state a
  distinct color or pulsing outline. **File:** bulk action bar in
  `MatchesView.vue`. **Effort:** S

### Frontend UX (Settings + Parse)

- [ ] `[MED]` "Detect Overwatch Folder" button has no loading state
  during the probe. Click feels missed. Add "Detecting…" +
  spinner. **File:** `SettingsView.vue`. **Effort:** S
- [ ] `[LOW]` "Last run · X ago" timestamp has no tooltip explaining
  its source. Add `title="Timestamp of the most recent…"`.
  **File:** `IngestView.vue:142`. **Effort:** S
- [ ] `[LOW]` Parse progress counter "42 / 187" lacks units. Add
  "files" so users don't misread it as match count. **File:**
  `IngestView.vue` progress panel. **Effort:** S
- [ ] `[MED]` Watch toggle disabled state only explained via
  `:title` tooltip; touch users can't see it. Surface a
  `.setting-meta.blocked` paragraph below the label. **File:**
  `IngestView.vue:110`. **Effort:** S

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

- [ ] `[MED]` Skip-link z-index conflict with the system-alert banner
  (when Tesseract is missing). Verify skip-link can land focus
  even when the alert overlay covers the page. **File:**
  `App.vue:1661`. **Effort:** S
- [ ] `[LOW]` Empty-suggestion buttons emit multiple child spans;
  screen readers announce them as fragmented content. Add a
  consolidated `aria-label` per button. **File:**
  `MatchesEmptySuggestions.vue:28-35`. **Effort:** S
- [ ] `[MED]` MatchDetailPanel + MatchScreenshotLightbox focus-trap
  sequence: test that nested-modal Esc closes the lightbox
  first, then the detail panel, with focus correctly returning
  to the original card. **File:** `MatchDetailPanel.vue` +
  `MatchScreenshotLightbox.vue` + a new e2e spec. **Effort:** M

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
