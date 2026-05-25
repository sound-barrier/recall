# Technical Debt

Living inventory of known technical debt in the Recall codebase. Each
item has the same four-section shape so they can be triaged, scoped,
and worked off independently. Update this file whenever debt is added
(record it the same week, with the same rigor) or paid down (delete
the section — not "strikethrough", not "✅", just delete it; git
history is the audit trail).

## How to read this file

Each item carries a **size** estimate that combines coding effort with
review/test/release surface area:

| Size | Rough effort | Examples |
|---|---|---|
| **S**  | < 2 hours | A single-file rename, one Makefile var, one config flip. |
| **M**  | ½–2 days | A refactor inside one package; new test file; small DI seam. |
| **L**  | 2–5 days | Multi-package refactor; new abstraction with migrations; CI rewiring. |
| **XL** | 1–2 weeks | Rewriting a monolith; introducing a new runtime dependency; reshaping an entire layer. |

A **plan** is a sequence of *small, independently mergeable* steps. If
a step needs a release or a contributor handoff, that's marked in line.
Anything that has to land atomically is called out.

The list is ordered by *risk × cost-to-fix-later*, not by size. The
top items are the ones most likely to bite if left alone. Pay them off
first.

---

## 1. App.vue styles — per-component scoped-style extraction (partial)

**Size: M (remaining)**

**Status.** Phase 3 landed the easy half: the 3 698-line `<style>`
block was extracted from App.vue (which dropped from 4 582 to ~890
lines) into a dedicated `frontend/src/styles/app.css`, imported
from App.vue's `<script setup>`. Selectors still cascade globally,
so behaviour is byte-for-byte identical — only the file boundary
moved. The CSS is now a regular `.css` file with proper editor
support and lints under the same Stylelint config.

**What's left.**
Component-specific selectors still live in the shared
`styles/app.css` rather than alongside the components that own
them. Adding a class to `MatchCard.vue` still means opening a
3 700-line file in a separate window to find the matching rule.
Specificity collisions (the `.match-header` / `:where()`
workaround) remain easy to miss.

**Mitigation plan (remaining steps).**

Per leaf component (smallest first — ParseProgressPanel →
MatchCard → MatchGroupSection → FilterRail → IngestView →
SettingsView → MatchesView → UnknownMapsView), one PR each:

1. Identify selectors in `styles/app.css` that target only the
   component's classes.
2. Move them into a `<style scoped>` block in the component SFC.
3. Verify visually with `npm --prefix frontend run dev` and run
   `make lint` + `make test`.
4. Merge.

Cross-cutting tokens (CSS custom properties, font-faces, theme
overrides) stay in `styles/app.css` as a shared file imported by
App.vue's shell.

**How large.**
M. ~1 day across 8 small PRs. The big-bang risk is gone — the
shared cascade is already external — so each component move is
mechanical (find selectors, move, verify, commit).

---

## 4. `wailsjs/go/models.ts` — long-term: regenerate from OpenAPI

**Size: L**

**What.**
The short-term guard (`scripts/check-wailsjs-models.sh`, now wired
into Make, lefthook, and CI) catches silent drift when a Go struct
field is added without the matching `wailsjs/go/models.ts` update.
That removes the worst symptom but the underlying duplication —
two parallel TypeScript type sources for the same Go data shape —
remains.

**Why it's debt.**
The `wailsjs/` directory is committed to git but generated, and
generated only on macOS. Linux and Windows contributors can't
refresh it. The "add a new exported method on App" four-step
process still requires a macOS contributor to regenerate. Every
macOS dev run produces uncommitted local diffs.

**Mitigation plan.**

1. The frontend already typechecks `api.ts` against `api.gen.d.ts`
   (from `make gen-types`). The Wails delegate path in `api.ts`
   currently uses untyped `window.go.app.App` calls.
2. Treat `api/openapi.yaml` as the single source of truth. Wails-
   mode delegation in `api.ts` can be typed via the same
   `paths['/api/foo']` types that the server path uses, with the
   request body shape lifted into the Wails call signature.
3. Once `api.ts` no longer reads from `wailsjs/go/models.ts`,
   `wailsjs/` can be removed from git entirely and added to
   `.gitignore` — it becomes a build artifact like `frontend/dist/`.
4. The wails-dev regen step on macOS still runs but its output is no
   longer load-bearing for typechecking.

**How large.**
L. Schedule when the four-step API-binding process becomes a real
bottleneck. The short-term CI guard makes this optional rather than
urgent.

---

---

## 7. Pre-existing `KNOWN_CONTRAST_DEBT` a11y exclusions — needs full design pass

**Size: M (revised)**

**What.**
`frontend/tests/e2e/a11y.spec.ts` keeps a baselined list of four CSS
selectors excluded from axe-core's color-contrast scan:

- `.theme-toggle` — Day/Night segmented control on Settings.
- `.weekstart-row` — first-day-of-week picker on Settings.
- `.setting-meta` — "Last run" / "blocked" hint text on Ingest.
- `.big-switch-state` — "Off" / "Armed" / "Live" labels on Ingest.

A Phase 3 attempt to retire the list surfaced additional context:
the rendering pipeline produces a noticeable luminance drop on small
text in the OW Wordmark / Futura font stack (~78% of the declared
`color:` value as measured by axe-core). Several elements OUTSIDE
the original four — `.engine-version`, `.setting-value`,
`.setting-desc`, `<em>` inside descriptions, and others — also fall
short of WCAG 2 AA when measured against the rendered (not declared)
foreground. They didn't surface earlier because the four-element
exclusion list partially shielded them when the Ingest view was in
its "Tesseract not detected" state in CI, which never renders
`.engine-version`.

**Why it's debt.**
External accessibility audits use rendered pixel values, not declared
sRGB. Every release that ships with `--text-faint` / `--text-dim`
calibrated for the declared-value contrast budget will flag on
audit even though the project intends to clear WCAG 2 AA. The
existing exclusion list under-states the actual scope.

**Mitigation plan.**

1. **Audit the rendering pipeline.** Determine why axe-core reports
   colors ~22% darker than declared (anti-aliasing? a parent
   `opacity`? font-smoothing?). Could be a single root cause whose
   fix lifts many elements above threshold at once.
2. **Re-baseline `--text-dim` and `--text-faint`** with margin for
   the rendering loss. Conservative starting point: each variable
   needs ~10% more luminance contrast against its typical surface
   than the WCAG threshold demands.
3. **Sweep all `var(--text-dim)` / `var(--text-faint)` usages**
   for contextual surface — some sit on `--surface-3`, others on
   `--surface-2`, others on `--bg`. Each needs its own check.
4. **Remove `KNOWN_CONTRAST_DEBT` entries one at a time** as
   selectors clear axe locally with the rebuilt binary (CRITICAL:
   `make test-e2e` rebuilds the embedded `frontend/dist`; `npx
   playwright test` against a stale binary will mislead).
5. Once the list is empty, delete the array and update CLAUDE.md's
   "A11y debt is tracked in…" bullet.

**How large.**
M. ~½ day for the rendering-pipeline root-cause analysis, then a
sequence of small color tunes. Needs design-lead sign-off on each
new shade because the existing `--text-faint` was chosen
deliberately for visual subtlety — bumping it changes hierarchy.

---

## 10. `release.yml` — composite-action + act-smoke-test residual

**Size: S (remaining)**

**Status.** Phase 4 landed the two biggest wins:

- The in-DMG `README.txt` heredoc moved to `docs/dmg/README.txt` —
  edited as a regular text file, copied into DMG staging by
  `scripts/release/make-dmg.sh`. No more paired-edit fragility with
  `docs/install-macos.md` sections 2-3 (the install-macos page now
  documents the file as the source of truth via the synced-region
  HTML comment).
- Every non-trivial shell body in `release.yml` extracted into
  `scripts/release/`:
  - `package-linux.sh` — Linux/Windows tarball + .deb + Windows
    artifact staging
  - `make-dmg.sh` — macOS DMG wrapping
  - `sign-image.sh` — cosign keyless container signing
  - `flip-package-public.sh` — GHCR visibility flip
  - `compute-sha256.sh` — per-artifact .sha256 sidecar files

The `SHELL_SCRIPTS` glob in `Makefile` now covers
`scripts/release/*.sh` so every script is shellcheck + shfmt
linted on every PR.

**What's left.**

1. **Composite actions** for the repeated "build via Docker"
   steps — Linux Wails and Windows Wails share most of their
   shape, and the same `actions/setup-go` + `actions/setup-node`
   prologue appears in multiple jobs. Each consolidation saves
   ~5 lines of YAML and removes a copy-paste drift hazard.
2. **`act` (Nektos/act) smoke tests** for the workflow's
   shell-only steps so future edits can be validated without
   cutting a real tag. Now that the shell logic is in real `.sh`
   files, each can be smoke-tested in isolation with fake env
   vars + fixture filesystem layout.
3. **Document the visibility-flip workaround** explicitly in
   CONTRIBUTING.md (or split off to RELEASES.md) so the
   `continue-on-error` band-aid stays intentional rather than
   accidentally removed. Right now the rationale lives only in
   the script's header comment and the workflow step's inline
   note — duplication is fine, but a maintainer-facing pointer
   would help.

**How large.**
S. ~½ day for the composite-action consolidation; act smoke tests
~1 day depending on appetite for testing local docker. None
urgent — the script extraction already moved the test-iteration
loop from "cut a release tag" to "run `bash scripts/release/X.sh`
with stub inputs", which is the biggest unlock.

---

## 12. Tests in `pkg/parser/integration_test.go` skip by default — fixture commit pending maintainer review

**Size: S (remaining)**

**What.**
The infrastructure work landed: `integration_test.go` defaults
`RECALL_FIXTURE_DIR` to `pkg/parser/testdata/golden/`, the
`make update-goldens` target seeds + regenerates `.golden.json`
sidecars, and the test runs as part of `make test` (skipping
cleanly while the dir is empty).

What's left: **commit a curated set of 4–6 fixture screenshots**.
That decision was deferred because the maintainer's
`screenshots/` dump (gitignored) contains other players'
BattleTags. See `pkg/parser/testdata/golden/README.md` for the
licensing + privacy considerations.

**Why it's still debt.**
Until fixtures are committed, the OCR pipeline — the most
failure-prone part of the codebase — has no end-to-end regression
net in CI. A Tesseract upgrade or image-decoding change can break
parsing without breaking any unit test.

**Mitigation plan (remaining steps).**

1. Pick 4–6 source screenshots covering each detected type
   (rank, summary, personal, scoreboard) plus the in-game
   scoreboard variant and one multi-hero edge case.
2. Crop or blur non-self BattleTags before committing — the parser
   doesn't read them, so blurring is harmless to test signal.
3. Drop the curated PNG files into `pkg/parser/testdata/golden/`.
4. Run `make update-goldens` to seed `.golden.json` sidecars.
5. Eyeball the JSON, commit both.
6. (Optional, only if golden flakes begin) pin Tesseract version
   in CI via `tool-versions.env` and add a per-field tolerance
   for OCR-borderline numeric fields.

**How large.**
S. ~1 hour of curation once the privacy review is done — no code
changes remain on the recall side.

---

## 14. `wails dev` only works on macOS; Linux/Windows dev runs serveronly

**Size: L**

**What.**
CLAUDE.md states multiple times: `make dev` is macOS-only; the
devcontainer can't render the Wails GUI; Linux/Windows contributors
use `go run -tags serveronly . --server`.

**Why it's debt.**
The Wails desktop variant is the primary product, but only macOS
contributors can debug its desktop-specific behavior (dialogs,
window chrome, AssetServer middleware ordering, NSIS installer
under wine, etc.). Cross-platform desktop bugs only surface in CI
release builds, where iteration is slow.

**Mitigation plan.**
This is structural debt, not a quick fix. Options:

**Option A (M):** improve the server-mode parity guarantee.

1. Audit every Wails-only code path (the `app_wails.go` /
   `app_server.go` split is the inventory) and tighten the parity.
2. Ensure every UI flow has equivalent server-mode coverage in
   `frontend/tests/e2e/` — so a regression in a desktop-only
   subtlety is at least detected at e2e time.
3. The dialog methods (`PickScreenshotsDir`, `PickTesseractBinary`)
   already have `window.prompt()` fallbacks per CLAUDE.md — verify
   the prompt path is e2e-tested.

**Option B (L):** containerize Wails dev with X11/Wayland forwarding.

1. Extend `.devcontainer/devcontainer.json` to mount the host's
   `/tmp/.X11-unix` (Linux) or use XQuartz (macOS host with Linux
   container).
2. Document the setup. Expect breakage on Windows hosts.
3. CI gains nothing from this; only contributor experience does.

**Option C (XL):** drop Wails-specific UI in favor of server-mode
only.

1. The server-mode HTTP variant is mostly feature-complete per
   CLAUDE.md. Could become the only variant, with the desktop
   experience delivered via a thin native shell (Tauri, Electron,
   or just "open a browser pointed at localhost:7000").
2. Substantial product call. Out of scope for tech-debt cleanup.

**How large.**
L if anything beyond Option A is pursued. Option A is the
realistic near-term move — bound the blast radius without
attempting to change the dev model.

---

## 17. CLAUDE.md is 75 KB and load-bearing for too many gotchas

**Size: M**

**What.**
`CLAUDE.md` is ~1 600 lines. The "Conventions worth knowing"
section alone has ~50 individually-numbered debt-bullets,
gotchas, and "this regex lives in three places" warnings.

**Why it's debt.**
CLAUDE.md is the AI-assistant brief. Its length is currently load-
bearing because the codebase has accumulated cross-cutting
constraints that aren't expressible in code. Every constraint that
lives only in CLAUDE.md is a constraint that:

- A new contributor (human or AI) only knows if they read 75 KB of
  prose first.
- Doesn't fail-loud when violated — silent breakage is the norm
  (see #4, #5, #6 above).
- Drifts from the code over time without anything noticing.

Many of the items in this file (#4, #5, #6, #11, #15) are direct
attempts to **convert CLAUDE.md prose into executable checks**. The
closure of that work eventually shrinks CLAUDE.md. The
already-completed "tool-versions.env + deadcode allow-list"
consolidation is the template: each replaced four CLAUDE.md
gotcha-bullets with one executable check.

**Mitigation plan.**
This is meta-debt. Pay it off by paying off the others. Track
progress: every time a CLAUDE.md bullet becomes a CI check or a
test, **delete the bullet from CLAUDE.md** (don't just cross it
out). The file's length is the inverse measure of how much tribal
knowledge has been codified.

Concrete near-term:

1. As #4 lands, delete the "Adding a field to an existing Go
   struct" bullet (or shrink it to one line cross-referencing the
   CI guard).
2. As #6 lands, delete the "Any CI job that loads the root `main`
   package…" bullet — the composite action replaces the convention.
3. As #5 lands, delete the "`go list ./...` includes a stray Go
   package in `node_modules`" bullet.
4. After ~6 months, CLAUDE.md should naturally trim by 20–40%.

**How large.**
M (cumulative). Each individual debt-payoff in this file shrinks
CLAUDE.md by a small amount; the gain is in the aggregate.

---

## Prioritized roadmap

A suggested order of attack. The first three are cheap, ratchet-
shaped wins that immediately reduce future debt accrual. The
middle group is structural refactor. The tail is product-level
choices.

### Already paid down

- Triplicated `deadcode` known-good filter — consolidated into
  `scripts/deadcode-allow.txt` + `scripts/deadcode-check.sh`
  consumed by Make, lefthook, and CI.
- Triplicated `@stoplight/spectral-cli` pin and other duplicated
  tool versions (typos, gosec, Honkit) — consolidated into
  `tool-versions.env` at repo root, validated by `make check-deps`.
- Go coverage floor (was 40%, well below actual ~48%) — ratcheted
  to 46% in `Makefile`'s `GO_COVERAGE_MIN`, with a written ratchet
  policy in `CONTRIBUTING.md` to bump it every release.
- `screenshotType()` ordering invariant — TestScreenshotType in
  `pkg/app/merge_test.go` already covered the "scoreboard with both
  E/A/D and panel hero stats stays scoreboard" case (audit miss);
  the function's comment block now cross-references that test name
  so a future refactor sees what would break before touching it.
- Read-time inference invariant — `pkg/app/inference_invariant_test.go`
  locks the rule that `inferSoleHeroPercent` and `inferResultFromRank`
  run on the way OUT of the DB via GetMatchResults / scrapeReader, never
  inside the merge path. A future refactor that "helpfully" moves
  inference into mergeMatchResult would silently corrupt match outcomes;
  the new tests fail loudly in that case.
- Stray dev binaries at repo root — `.gitignore` now has an explicit
  `# Stray dev builds dropped at repo root` section covering all six
  shapes (Recall, recall, *.exe, .app, server variants) and `make
  clean` removes them. Contributors who accidentally `go build` at
  repo root get a one-command cleanup path.
- Tag-pinned GitHub Actions — all 33 unique third-party action refs
  across `.github/workflows/` converted to SHA pins with trailing
  `# vX.Y.Z` comments. `scripts/check-action-pins.sh` enforces
  the convention from `make lint-actions`, the lefthook
  `pre-push.actionlint` block, and the CI lint job. Dependabot
  bumps both the SHA and the comment in lock-step. CONTRIBUTING.md
  documents the policy.
- Short-term: `wailsjs/go/models.ts` drift —
  `scripts/check-wailsjs-models.sh` extracts every json tag from the
  Wails-exposed Go structs (MatchRecord, UpdateInfo, TesseractStatus,
  MatchResult, HeroSR, HeroPlay, Performance, PerformanceStat) and
  asserts each appears as a field in `models.ts`. Wired into
  `make check-wailsjs`, the lefthook `pre-commit.wailsjs-sync` hook,
  and the CI lint job. The long-term "generate wailsjs from
  OpenAPI" path remains open as item #4 below.
- `//go:embed all:frontend/dist` setup duplication — extracted into
  the `.github/actions/prepare-frontend-dist` composite action with
  a `real-assets: 'true' | 'false'` input. CodeQL, ci.yml lint,
  ci.yml gosec, coverage-go, and schemathesis all call the composite
  instead of inlining `mkdir/touch` or `npm ci && npm run build`.
  CONTRIBUTING.md documents the convention; `scripts/check-action-pins.sh`
  now scans both `.github/workflows/` and `.github/actions/` so the
  composite's own SHA pins stay enforced.
- Eagerly-imported view components — App.vue now loads
  IngestView/MatchesView/SettingsView/UnknownMapsView via
  `defineAsyncComponent`. Initial JS chunk dropped from ~156 KB
  to ~103 KB (35% reduction); each view emits its own Vite chunk
  fetched on first render. `App.lazy-views.test.ts` locks the
  pattern: any view re-converted to a static `import` fails CI.
  The bundle-size budget step gains separate initial-vs-total
  limits so a regression in either dimension is caught.
- `release.yml` shell extraction — `scripts/release/package-linux.sh`,
  `make-dmg.sh`, `sign-image.sh`, `flip-package-public.sh`,
  `compute-sha256.sh` carry the non-trivial shell bodies that used
  to live inline in the workflow. The in-DMG README.txt is now a
  real file at `docs/dmg/README.txt` (no more heredoc paired with
  `docs/install-macos.md`). `Makefile`'s `SHELL_SCRIPTS` glob
  covers `scripts/release/*.sh` so every script is lint-checked.
- `frontend/node_modules/flatted/golang/` no longer pollutes
  `go list ./...` — `frontend/scripts/seed-go-sentinel.cjs` runs
  as an npm `postinstall` hook and drops a stub
  `frontend/node_modules/go.mod` after every `npm ci`. Go's
  package walker stops at that boundary; the recall module no
  longer absorbs the stray `.go` file. `frontend/dist` is left
  inside the recall module so `//go:embed all:frontend/dist` in
  `assets.go` still works. The historical filter workarounds in
  `scripts/deadcode-check.sh` and `make lint-gosec` stay as
  defence in depth.
- Parser golden-file fixture infrastructure — `integration_test.go`
  defaults `RECALL_FIXTURE_DIR` to `pkg/parser/testdata/golden/`,
  `make update-goldens` seeds + regenerates sidecars, the test
  skips cleanly while the dir is empty. The actual fixture commit
  is item #12 below — gated on maintainer privacy / IP review of
  the candidate screenshots.
- `pkg/app/app.go` 1 710-line grab-bag — split into 12 per-concern
  files (`settings.go`, `tesseract.go`, `watcher.go`,
  `metrics_lifecycle.go`, `update.go`, `screenshots_dir.go`,
  `screenshot_handler.go`, `inference.go`, `match_record.go`,
  `merge.go`, `parse.go`, plus `app.go` itself reduced to ~130
  lines covering only the `App` struct + constructors + `Startup`).
  Pure file moves — package public surface unchanged; the existing
  9-way test-file split now mirrors the production split 1:1.
- `pkg/parser/parser.go` 1 562-line monolith — split into 11
  per-concern files (`types.go`, `heroes.go`, `maps.go`,
  `tesseract.go`, `imageutil.go`, `text.go`, `parse_rank.go`,
  `parse_summary.go`, `parse_personal.go`, `parse_scoreboard.go`,
  plus `parser.go` itself reduced to 156 lines holding the
  dispatcher + `ParseScreenshotsDir` + `parseSingleFunc` seam).
  The four parser-variant probes + entry points now sit one per
  file alongside the helpers they own.
- App.vue's 3 698-line `<style>` block — extracted into
  `frontend/src/styles/app.css`, imported from App.vue's
  `<script setup>`. SFC drops from 4 582 lines to ~890 lines;
  selectors still cascade globally so no specificity changes.
  Component-by-component extraction into scoped `<style>` blocks
  is the residual #1 item below.

### Phase 1 — drift prevention ✅ COMPLETE

1. ~~#8 Go coverage floor ratchet (S)~~ — done
2. ~~#15 screenshotType ordering test (S)~~ — done (audit miss, already covered; tightened the comment to cite the test)
3. ~~#11 inference invariant test (S)~~ — done
4. ~~#16 .gitignore stray binaries (S)~~ — done
5. ~~#9 SHA-pin GitHub Actions (M)~~ — done

### Phase 2 — guard rails ✅ COMPLETE

1. ~~#4 wailsjs models.ts CI guard, short-term form (M)~~ — done
2. ~~#6 prepare-go-build composite action (S)~~ — done (named `prepare-frontend-dist`)
3. ~~#13 lazy-load view components (S)~~ — done
4. ~~#12 commit golden-file fixtures + CI integration (M)~~ — infrastructure done; fixture commit pending maintainer privacy review

### Phase 3 — structural refactor ✅ COMPLETE

1. ~~#2 split `pkg/app/app.go` into per-concern files (L)~~ — done
2. ~~#3 split `pkg/parser/parser.go` into per-concern files (L)~~ — done
3. ~~#1 extract App.vue's `<style>` into per-component scoped blocks (L)~~ — partial; per-component scoping remaining as residual #1
4. ~~#7 retire `KNOWN_CONTRAST_DEBT` selectors one at a time (M)~~ — scoped up after investigation revealed wider rendering-vs-declared-color gap; #7 rewritten to capture the broader picture

### Phase 4 — opportunistic / product-level

1. ~~#5 move Go module root out of overlap with frontend/ (S)~~ — done (npm postinstall hook seeds frontend/node_modules/go.mod sentinel; defence-in-depth workarounds kept)
2. ~~#10 release.yml script extraction (M)~~ — done (composite-action + act-smoke-test residual)
3. #4 long-term: wailsjs from OpenAPI (L)
4. #14 server-mode parity audit or Wails containerization (L)
5. #17 CLAUDE.md naturally shrinks as a side effect

### Total estimated cost

Roughly **4–6 weeks of focused work** remaining across all four
phases, spread across the project's release cadence. None of it is
urgent — the codebase is in good shape today. The point of this
file is to make the latent costs visible so they don't compound
silently.
