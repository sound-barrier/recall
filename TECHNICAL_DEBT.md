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

## 1. `App.vue` style block is a 3 699-line monolith

**Size: L**

**What.**
`frontend/src/App.vue` is 4 582 lines total — but only 300 of those
are `<template>` and 578 are `<script>`. The remaining **3 699 lines
are `<style>`**, scoped at the App root. Selectors in there target
elements rendered by SettingsView, IngestView, MatchesView,
UnknownMapsView, MatchCard, FilterRail, ParseProgressPanel,
MatchGroupSection — every component in the tree.

**Why it's debt.**
The template/script extraction already happened (good!) — App.vue is
now the "router shell" CLAUDE.md describes. But because the styles
weren't extracted alongside, every component change still requires
opening App.vue to find the matching selector. Symptoms:

- Adding a class to `MatchCard.vue` means scrolling 3.7k lines of
  unrelated CSS to find where to put the rule.
- Specificity collisions are easy to miss (the `.match-header` /
  `:where()` workaround in CLAUDE.md was caused by exactly this
  shape).
- The CSS-`.test.ts` mapping is opaque — Vitest snapshot or
  Stylelint failure references App.vue:NNNN, not the owning
  component.
- `make lint` errors point at `App.vue` for issues that semantically
  belong to other components.

**Mitigation plan.**
The principle: each component owns its own visual rules. Cross-
cutting tokens stay shared.

1. **Create `frontend/src/styles/` directory** with:
   - `tokens.css` — CSS custom properties (colors, spacings, fonts).
   - `reset.css` — global element resets (the `:where(button.badge)` family).
   - `typography.css` — the three `@font-face` declarations.
   - `layout.css` — masthead, modal, skip-link, tablist (App.vue-owned UI).
2. **Move** the cross-cutting rules from App.vue's `<style>` into
   those files; `import './styles/tokens.css'` etc. from `main.ts`.
3. For each leaf component, **lift its selectors** out of App.vue
   into a scoped `<style scoped>` block in the component SFC. Do
   this one component at a time, in this order (smallest first):
   ParseProgressPanel → MatchCard → MatchGroupSection → FilterRail →
   IngestView → SettingsView → MatchesView → UnknownMapsView.
4. For each component move:
   - copy selectors that *only* affect that component into the SFC,
   - delete from App.vue,
   - run `make lint` + `make test` + `npm --prefix frontend run dev`
     and eyeball the component before merging,
   - merge **per component** — small reversible steps.
5. After all eight moves, App.vue's `<style>` should be < 400 lines
   covering only the masthead/modal/tablist shell.
6. Update CLAUDE.md's "Frontend" section to drop the "App.vue is a
   router-shell" note about style ownership.

**How large.**
L. 2–4 days spread across 8 PRs (one per component move). Each PR
is safe to revert independently because component CSS in the SFC
takes precedence over App.vue's parent-level rules during the
transition. No atomic landing required.

---

## 3. `pkg/parser/parser.go` is a 1 562-line monolith

**Size: L**

**What.**
`pkg/parser/parser.go` contains all four parser variants (rank,
summary, personal, scoreboard) plus their shared infrastructure:

- Tesseract binary path globals (`tesseractPath`, `tesseractMu`,
  `SetTesseractPath`, `getTesseractPath`).
- `MatchResult`, `HeroSR`, `HeroPlay`, `Performance`,
  `PerformanceStat` types.
- `knownMaps`, `heroRoles`, `HeroRole`.
- The dispatcher (`ParseScreenshot`).
- `parseScoreboard` + all its helpers (`parsePanelStats`,
  `findHighlightedRowY`, `ocrRowCells`, `findRowXExtent`,
  `findStatColumns`).
- `parseSummary` + helpers (`extractHeader`, `extractGameType`,
  `extractInts`, `snapToKnownMap`, `bestKnownMapInText`,
  `levenshtein`, `extractHeroes`, `heroNamesByLength`,
  `parseHeroesPlayed`, `parsePerformance`, `parseRightCard`,
  `digitize`, `normalizeDate`).
- `parsePersonal` + helpers (`parsePersonalHeroCell`,
  `parsePersonalStatCell`, `trimShortBoundaryWords`, `labelToKey`).
- `parseRank` + helpers (`isRankScreenshot`, `extractRank`,
  `knownRanks`, `knownModifiers`).
- OCR primitives (`ocrInverted`, `ocrRaw`, `runTesseract`,
  `runTesseractFunc`).
- Image utilities (`crop`, `upscale`, `preprocessInverted`).
- Detection probes (`isSummaryScreenshot`, `isPersonalScreenshot`).
- `ParseScreenshotsDir` (the entry point used by the App).

**Why it's debt.**
Same shape as #2 but worse: a single file mixes I/O (Tesseract
shell-out), pure data (hero/map tables), pixel math, OCR text
post-processing, and four distinct dispatch targets. Symptoms:

- Adding a new screenshot type requires reading ~1 500 lines to
  understand where to inject a probe + parser.
- Refactoring the OCR primitives touches everything because they're
  in the same file as their callers.
- The four parser variants have non-obvious dependencies on shared
  helpers — there's no compile-time enforcement that
  `parseScoreboard`'s helpers stay isolated from `parseRank`'s.
- `runTesseractFunc` and `parseSingleFunc` are package-level
  function-variable seams — fine in isolation, but they pollute the
  package namespace and complicate parallel test isolation.

**Mitigation plan.**
Same shape as #2: split along the natural seams, keep the package
public surface stable.

1. `pkg/parser/types.go` — `MatchResult`, `HeroSR`, `HeroPlay`,
   `Performance`, `PerformanceStat`.
2. `pkg/parser/heroes.go` — `heroRoles`, `HeroRole`, `extractHeroes`,
   `heroNamesByLength`.
3. `pkg/parser/maps.go` — `knownMaps`, `snapToKnownMap`,
   `bestKnownMapInText`, `levenshtein`.
4. `pkg/parser/tesseract.go` — `tesseractPath`/`tesseractMu`/
   `SetTesseractPath`/`getTesseractPath`, `runTesseract`,
   `runTesseractFunc`, `ocrInverted`, `ocrRaw`.
5. `pkg/parser/imageutil.go` — `crop`, `upscale`,
   `preprocessInverted`.
6. `pkg/parser/text.go` — `digitize`, `normalizeDate`,
   `extractInts`, `extractGameType`, `extractHeader`,
   `trimShortBoundaryWords`, `labelToKey`.
7. `pkg/parser/parse_rank.go` — `isRankScreenshot`, `parseRank`,
   `knownRanks`, `knownModifiers`, `extractRank`.
8. `pkg/parser/parse_summary.go` — `isSummaryScreenshot`,
   `parseSummary`, `parseHeroesPlayed`, `parsePerformance`,
   `parseRightCard`.
9. `pkg/parser/parse_personal.go` — `isPersonalScreenshot`,
   `parsePersonal`, `parsePersonalHeroCell`,
   `parsePersonalStatCell`.
10. `pkg/parser/parse_scoreboard.go` — `parseScoreboard`,
    `findHighlightedRowY`, `parsePanelStats`, `ocrRowCells`,
    `findRowXExtent`, `findStatColumns`.
11. `pkg/parser/parser.go` is left with `ParseScreenshot` (the
    dispatcher), `ParseScreenshotsDir`, `parseSingleFunc`.

Each step is a mechanical move + import fix. The existing
`parser_test.go` (526 lines) should be split alongside, but that's
optional — Go's test discovery doesn't care.

**How large.**
L. 3–5 days spread across 10 PRs. Same risk profile as #2: no
behavior change. Worth doing **after** #2 so the App reorg is the
known-good template.

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

## 5. `frontend/node_modules/flatted/golang/` pollutes `go list ./...`

**Size: S**

**What.**
The `flatted` npm package ships a `.go` file in `frontend/node_modules/
flatted/golang/pkg/flatted/`. Because the repo's `go.mod` is at the
repo root, that file is treated as part of the `recall` Go module.

CLAUDE.md documents the workarounds:

- Any tool that takes a package list must filter:
  `go list ./... | grep -v node_modules`.
- gosec uses `gosec -exclude-dir=frontend ./...`.

**Why it's debt.**

- Every new whole-program Go tool added to lint/CI has to remember
  the dance. Forgetting it produces opaque errors (gosec's "0 files
  inspected" is the canonical one).
- The dependency is on `frontend/node_modules/`, which is recreated
  by `npm ci` — there's no permanent fix at the npm level (the
  upstream package is what it is).
- New contributors are likely to hit it the first time they reach
  for a new Go tool.

**Mitigation plan.**
Pick one:

**Option A (recommended, S):** move the Go module root.

1. Move `go.mod` + `go.sum` into a subdirectory (e.g. `cmd/recall/`
   or restructure with the Go code under `./go/`).
2. Update all import paths once (`gopls rename` handles it).
3. Update Makefile, Dockerfile.build, all CI workflows to `cd` into
   the new root.
4. The `frontend/` tree no longer overlaps the Go module — `go
   list ./...` is clean.

**Option B (M):** add a `.go-list-filter` convention.

1. Add `scripts/go-pkgs.sh` that prints the filtered package list.
2. Replace every `go list ./...` invocation in the repo with
   `$(scripts/go-pkgs.sh)`.
3. Document the convention in CLAUDE.md.

**Option C (cheapest, S):** leave the workarounds; promote them
from "convention" to "tested".

1. Add a CI test that asserts the filter still produces a non-empty
   set + that an unfiltered `go list ./...` exits non-zero (today)
   or includes the unwanted package — so a future npm dep change
   that quietly fixes the situation is caught and the workarounds
   can be removed.

**How large.**
S for A or C; M for B. **A** is the right long-term answer (most Go
projects keep the module root under a `cmd/` or `internal/`
subdirectory anyway) but it's a one-time blast radius across every
import path. Worth doing as a single atomic PR when there's a quiet
window.

---

## 7. Pre-existing `KNOWN_CONTRAST_DEBT` a11y exclusions

**Size: M**

**What.**
`frontend/tests/e2e/a11y.spec.ts` line 28 has a baselined list of
four CSS selectors excluded from the axe-core color-contrast scan:

- `.theme-toggle` — Day/Night segmented control on Settings.
- `.weekstart-row` — first-day-of-week picker on Settings.
- `.setting-meta` — "Last run" / "blocked" hint text on Ingest.
- `.big-switch-state` — "Off" / "Armed" / "Live" labels on Ingest.

**Why it's debt.**
The integration commit chose to ship with these four pre-existing
WCAG 2 AA color-contrast failures rather than block on rework.
That was the right call at the time — but every release that ships
with the exclusion list intact is a known a11y regression that
external accessibility audits will surface.

**Mitigation plan.**
Per CLAUDE.md's existing guidance: "Fixing one is straightforward:
tweak the relevant rule in `frontend/src/App.vue`'s styles until the
contrast ratio clears WCAG 2 AA, then delete the line from
`KNOWN_CONTRAST_DEBT` and watch the test stay green."

1. **Pick the easiest first** to reduce the list — probably
   `.setting-meta` (likely a text color, single rule).
2. Use Chrome DevTools' Contrast picker to find a foreground that
   clears 4.5:1 against the current background (or vice versa) and
   matches the visual design intent.
3. Edit the rule in App.vue (or wherever the rule lands after
   #1's component-CSS extraction).
4. Delete the line from `KNOWN_CONTRAST_DEBT`. Run
   `npm --prefix frontend run test:e2e` locally — the test should
   stay green.
5. PR per fix, one selector at a time.
6. After all four are fixed: delete the `KNOWN_CONTRAST_DEBT` array
   from `a11y.spec.ts` entirely. Update CLAUDE.md's "A11y debt is
   tracked in…" bullet to remove the reference.

**How large.**
M. ~1–2 hours per selector × 4 = ½ day total. Risk is purely
visual — the only failure mode is "design lead doesn't like the new
shade", in which case iterate. No functional code change.

---

## 10. `release.yml` carries a lot of bespoke logic

**Size: M**

**What.**
`.github/workflows/release.yml` does:

- 4 parallel build jobs (Linux + Windows Wails via Docker, macOS
  Wails native, all server binaries, container image).
- SBOM generation.
- DMG packaging (Apple runner, `hdiutil`, in-DMG `README.txt`
  generated inline via heredoc).
- Container signing via cosign (keyless OIDC, sign-by-digest).
- Build-provenance attestation.
- Per-artifact `.sha256` files.
- GHCR push + visibility flip.
- A `workflow_dispatch` fallback for the case CLAUDE.md documents
  ("when release-please's `GITHUB_TOKEN`-authored tag failed to
  chain").

**Why it's debt.**
The complexity isn't gratuitous — every piece exists because the
project deliberately ships signed, verifiable releases. The debt is
that all of it lives in one YAML file with shell-script bodies, and
testing changes requires either cutting a tag (high cost) or
firing `workflow_dispatch` (still produces real GHCR pushes, real
releases).

Specifically:

- The in-DMG `README.txt` heredoc is paired with `docs/install-
  macos.md` sections 2-3 and has to be edited in lock-step. CLAUDE.md
  flags this with an HTML comment in the synced region, but the
  pairing is fragile.
- The cosign `tag%:*}@${DIGEST}` digest-derivation lives inline in
  YAML rather than in a tested script.
- The visibility-flip "with `continue-on-error`" workaround documents
  that `GITHUB_TOKEN` lacks the right OAuth scope — a band-aid that
  could be a real fix if the workflow used a PAT for visibility only.

**Mitigation plan.**

1. **Extract shell bodies into `scripts/release/`**: `make-dmg.sh`,
   `sign-image.sh`, `compute-sha256.sh`, `flip-package-public.sh`.
   Each gets a unit test where reasonable (e.g. the sha256 logic).
2. **Move the in-DMG `README.txt` content** into a static file in
   `docs/dmg/README.txt`. The workflow copies it during DMG
   staging. `docs/install-macos.md` cross-links to the file
   instead of CLAUDE.md describing a heredoc.
3. **Use composite actions** for the repeated "build via Docker"
   steps — Linux Wails and Windows Wails share most of their
   shape.
4. **Add `act` (Nektos/act) smoke tests** for the workflow's
   shell-only steps so future edits can be validated without
   cutting a real tag.
5. **Document the visibility-flip workaround** explicitly in
   CONTRIBUTING.md (or split off to RELEASES.md) so the
   `continue-on-error` band-aid is intentional, not accidental.

**How large.**
M. ~1 day for the script extraction + DMG README move; another ½
day for composite actions if scoped tightly. Don't extract for the
sake of extracting — only break up the YAML where the *body* is
non-trivial and would benefit from local testing.

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

### Phase 3 — structural refactor (2–3 weeks, L items)

1. ~~#2 split `pkg/app/app.go` into per-concern files (L)~~ — done
2. #3 split `pkg/parser/parser.go` into per-concern files (L)
3. #1 extract App.vue's `<style>` into per-component scoped blocks (L)
4. #7 retire `KNOWN_CONTRAST_DEBT` selectors one at a time (M)

### Phase 4 — opportunistic / product-level

1. #5 move Go module root out of overlap with frontend/ (S — schedule a quiet window)
2. #10 release.yml script extraction (M)
3. #4 long-term: wailsjs from OpenAPI (L)
4. #14 server-mode parity audit or Wails containerization (L)
5. #17 CLAUDE.md naturally shrinks as a side effect

### Total estimated cost

Roughly **4–6 weeks of focused work** remaining across all four
phases, spread across the project's release cadence. None of it is
urgent — the codebase is in good shape today. The point of this
file is to make the latent costs visible so they don't compound
silently.
