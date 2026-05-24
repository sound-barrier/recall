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

## 2. `pkg/app/app.go` is a 1 710-line grab-bag

**Size: L**

**What.**
`pkg/app/app.go` contains, in one file:

- The `App` struct + constructors (`New`, `NewWithStore`).
- `Settings` + load/save + `defaultSettings`.
- `MatchRecord`, `UpdateInfo`, `TesseractStatus` types.
- Tesseract probe + version parsing (`checkTesseract`,
  `parseTesseractVersion`, `defaultTesseractPath`).
- `appDataDir` / `settingsPath`.
- Watcher lifecycle (`startWatching` / `runWatchLoop` /
  `runWatchEvents` / `scheduleParseDebounced` / `stopWatching`).
- Metrics lifecycle (`startMetrics` / `stopMetrics` /
  `GetPrometheusEnabled` / `SetPrometheusEnabled`).
- Version + update check (`GetVersion`, `CheckForUpdate`,
  `releasesURL`).
- Screenshots-dir + tesseract-path getters/setters + validators
  (`validateScreenshotsDir`, `validateTesseractPath`,
  `safePathChars`).
- `ScreenshotHandler` (HTTP).
- The parse + merge orchestration (`ParseScreenshots`,
  `loadExistingMergedRows`, `findMergeIntoExisting`,
  `timestampWindowOverlap`, `rowsConflict`, `unionSortedStrings`).
- Read-time inference (`inferSoleHeroPercent`,
  `inferResultFromRank`).
- `ParseProgressEvent` + `screenshotType` (~50 lines).

**Why it's debt.**
The file violates SRP at the package-organization level. Symptoms:

- New contributors can't form a mental map of "what lives where"
  from filenames — they have to grep within one giant file.
- Diff review pulls in unrelated context every time anything
  changes (e.g. a Tesseract probe edit shows up in the same file as
  a merge-orchestration edit).
- The test files are already split nine ways (`check_for_update_test.go`,
  `merge_orchestration_test.go`, `merge_test.go`,
  `screenshot_handler_test.go`, `settings_io_test.go`,
  `store_integration_test.go`, `tesseract_version_test.go`,
  `timestamp_test.go`, `validate_test.go`, `watch_events_test.go`)
  but production code isn't — the split is asymmetric and the
  test files broadcast where the seams *should* be.

**Mitigation plan.**
Use the test-file split as the de facto contract for the production
split. Each refactor is a pure file move (`git mv` + import
adjustments); the package public surface stays identical so no
caller changes.

1. `pkg/app/settings.go` — `Settings`, `loadSettings`,
   `loadSettingsFrom`, `defaultSettings`, `saveSettings`,
   `marshalSettings`, `settingsPath`, `appDataDir`.
2. `pkg/app/tesseract.go` — `TesseractStatus`,
   `defaultTesseractPath`, `checkTesseract`,
   `parseTesseractVersion`, `GetTesseractStatus`,
   `SetTesseractPath`, `ResetTesseractPath`,
   `validateTesseractPath`.
3. `pkg/app/watcher.go` — `startWatching`, `runWatchLoop`,
   `runWatchEvents`, `scheduleParseDebounced`, `stopWatching`,
   `GetWatchEnabled`, `SetWatchEnabled`.
4. `pkg/app/metrics_lifecycle.go` — `startMetrics`, `stopMetrics`,
   `GetPrometheusEnabled`, `SetPrometheusEnabled`.
5. `pkg/app/update.go` — `UpdateInfo`, `GetVersion`,
   `CheckForUpdate`, `releasesURL`.
6. `pkg/app/screenshot_handler.go` — `ScreenshotHandler`.
7. `pkg/app/parse.go` — `ParseScreenshots`,
   `loadExistingMergedRows`, `findMergeIntoExisting`,
   `timestampWindowOverlap`, `rowsConflict`, `unionSortedStrings`,
   `ParseProgressEvent`, `screenshotType`, the read-time inference
   helpers.
8. `pkg/app/validate.go` — `validateScreenshotsDir`, `safePathChars`,
   `GetScreenshotsDir`, `SetScreenshotsDir`.
9. `pkg/app/app.go` is left with: `App` struct, `New`, `NewWithStore`,
   `Startup`, `MatchRecord` — < 200 lines.

Each step is a separate, mechanically-reviewable PR. After each
step: `go build ./... && go build -tags serveronly ./... &&
make test && make lint` must pass.

**How large.**
L. 4–6 days spread across 8 PRs. Mechanical refactor with high
reviewer leverage (small, obvious diffs). No behavior change — risk
is contained to merge-conflict cost while the refactor is in flight,
so do this during a quiet period.

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

## 4. `wailsjs/go/models.ts` requires manual hand-editing

**Size: M**

**What.**
CLAUDE.md is explicit: "Adding a field to an existing Go struct is a
3-step follow-up: (1) update the struct + OpenAPI schema, (2)
`make gen-types` to refresh `api.gen.d.ts`, (3) manually edit
`wailsjs/go/models.ts` to add the field — Wails only auto-regenerates
that file during `wails dev` (macOS only). Missing step 3 breaks
Wails mode silently."

**Why it's debt.**

- Silent breakage in Wails mode while server mode (the path
  contributors on Linux/Windows can actually run) continues to
  work. The bug only surfaces in a release build on macOS.
- Linux and Windows contributors can't refresh wailsjs at all
  without spinning up macOS (or docker-cross with X11, which the
  devcontainer note says doesn't work).
- The four-step "add a new exported method on App" process
  (CLAUDE.md, "Frontend imports from `'./api'`" bullet) has the same
  problem at step 2: only macOS contributors regenerate wailsjs/.
- The `wailsjs/` directory is committed to git but generated —
  every macOS run during dev produces local diffs that contributors
  have to remember to commit or revert.

**Mitigation plan.**
Two paths, in increasing order of effort:

**Short-term (M):** add a CI guard.

1. Write `scripts/check-wailsjs-models.sh` that:
   - extracts every `json:"foo"` tag from `pkg/app/app.go` (and
     other types exposed via Wails),
   - greps `wailsjs/go/models.ts` for each tag name,
   - exits 1 with a "models.ts missing field 'foo' — see CLAUDE.md"
     message on any miss.
2. Wire it into `ci.yml` as a step that runs on every PR. Now the
   "silent" failure becomes a CI failure with a pointed message.
3. Same script can also run in lefthook's pre-push so a contributor
   catches it locally before the round-trip to CI.

**Long-term (L):** generate `wailsjs/` from the OpenAPI spec.

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
M for the short-term CI guard. L for the long-term wailsjs-from-
OpenAPI work. Do the short-term first — it's a few hours and turns
a silent class of bug into a noisy one. Schedule the long-term work
when the four-step API-binding process becomes a real bottleneck.

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

## 6. `//go:embed all:frontend/dist` blocks Go-only CI jobs

**Size: S**

**What.**
`assets.go` at the repo root has `//go:embed all:frontend/dist`. The
`frontend/dist/` directory doesn't exist on a fresh runner. Every CI
job that loads the root Go package (gosec, deadcode, schemathesis-
server, the build jobs, anything that runs `go build` or `go list`)
must either:

- Stub the dist (`mkdir -p frontend/dist && touch frontend/dist/index.html`)
  — what the gosec job does, per the recent fix commit.
- Or do a real frontend build first (`cd frontend && npm ci &&
  npm run build`) — what the e2e and build-server-* jobs do.

**Why it's debt.**

- Every new CI job has to think about which fix to use. Forgetting
  produces `pattern all:frontend/dist: no matching files found` —
  noisy but the failure mode isn't obvious until you've seen it.
- The stub is a magic incantation that lives in N copies of YAML.
- A future contributor adding a new embed (e.g. for a manifest or
  signing material) will hit the same shape.

**Mitigation plan.**

1. Add a CI composite action `.github/actions/prepare-go-build/`
   with two inputs: `with-real-assets: true|false`.
2. The action does either the stub or the real build based on the
   input, then sets up Go.
3. Replace the inline stubs/builds in `ci.yml`, `e2e.yml`,
   `release.yml` with the composite-action invocation.
4. Document in CLAUDE.md (under "Any CI job that loads the root
   `main` package…") that the composite action is the canonical
   way; ad-hoc stubbing is forbidden.

**How large.**
S. ~2 hours. Pays itself back the next time a new CI job is added.

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

## 9. GitHub Actions are tag-pinned, not SHA-pinned

**Size: M**

**What.**
Throughout the workflows under `.github/workflows/`:

- `actions/checkout@v4`
- `actions/setup-go@v6`
- `EnricoMi/publish-unit-test-result-action`
- `irongut/CodeCoverageSummary`
- `marocchino/sticky-pull-request-comment`
- `EndBug/label-sync@v2`
- `crate-ci/typos@vX.Y.Z`
- `sigstore/cosign-installer@v3`
- `anchore/sbom-action`
- `actions/attest-build-provenance@v2`

All pinned by *tag*, not by *commit SHA*.

**Why it's debt.**
Supply-chain risk: a tag can be silently re-pointed to a malicious
commit by a compromised maintainer account (this has happened in
the ecosystem — tj-actions/changed-files in 2025 is the canonical
case). GitHub's own security guidance is to pin third-party actions
by SHA.

The cost of NOT pinning is mostly latent: most days nothing
happens. But when it does happen, every workflow run that fires
after the malicious push runs malicious code with the workflow's
permissions — which, on the publish-container and release jobs,
include `id-token: write` and `packages: write`.

**Mitigation plan.**

1. Use `pinact` (or `actionlint --pin`) to convert every external
   `uses:` from tag-pinned to SHA-pinned. Result is e.g.:
   `actions/checkout@8e5e7e5ab8b370d6c329ec480221332ada57f0ab # v4.1.7`.
   The comment after the SHA preserves human-readable version
   tracking.
2. First-party actions (`./.github/actions/…` once #6 lands) don't
   need SHAs — they're checked out from the same repo.
3. Add `pinact run --check` to CI as a lint step so a future PR
   that adds an unpinned action fails the build.
4. Document the policy in CONTRIBUTING.md ("Adding a workflow:
   third-party actions must be SHA-pinned").
5. Schedule a recurring task (existing `dependabot.yml` config) to
   bump the SHAs — dependabot understands the `# v4.1.7` comment
   suffix and will update both the SHA and the tag comment
   together.

**How large.**
M. ~½ day for the initial conversion across ~10 workflows.
Recurring effort is near-zero once dependabot handles the bumps.

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

## 11. `pkg/app/app.go`'s read-time inference is fragile by design

**Size: S — documentation, M — behavioral lock-in**

**What.**
CLAUDE.md notes: "Some derived fields are filled by helpers in
`pkg/app/app.go` (`inferSoleHeroPercent`, `inferResultFromRank`)
that run on the way *out* of the DB via `GetMatchResults` and
`scrapeReader` — never inside `mergeMatchResult` or
`loadExistingMergedRows`. Reason: storing the inferred value would
break the merge's first-non-empty-wins rule when a later screenshot
arrives with the real value."

**Why it's debt.**
The constraint is real ("storing the inferred value would break
merge"), and the current implementation enforces it correctly — but
it lives entirely in tribal knowledge plus the CLAUDE.md note.
There's no compile-time or test-time guard preventing a future
contributor from "helpfully" moving inference into the merge path
to "avoid recomputing on every read".

If that happens, the bug is subtle: SR-inferred results would
silently overwrite SUMMARY-screen results. Wouldn't show up in any
test because the test fixtures match the in-the-wild case.

**Mitigation plan.**

1. **Lock the seam with a test.** Add `inference_invariant_test.go`
   with a fixture that has a rank-only row in the DB (so inference
   fires) and assert that `GetMatchResults` returns the inferred
   `result="victory"` but the *underlying row* (read directly via
   the Store) still has empty `result`.
2. Add another test where a SUMMARY screenshot arrives later with
   the real `result="defeat"`, the merge runs, and the stored row
   now has `defeat` — confirming inference would have been wrong.
3. Rename the inference helpers to `inferAtReadTimeX` so the
   constraint is in the symbol name, not just the comment.
4. If/when the helpers grow beyond two: extract them into
   `pkg/app/inference.go` with a package-level doc comment naming
   the invariant explicitly. (This becomes natural once #2
   happens.)

**How large.**
S for the documentation + tests; M if a future "real" inference
field is added that needs more sophisticated invariants. Worth
doing the S version proactively.

---

## 12. Tests in `pkg/parser/integration_test.go` skip by default

**Size: M**

**What.**
`pkg/parser/integration_test.go` (the golden-file parser tests)
skips unless `RECALL_FIXTURE_DIR` is set, and CI never sets it. So
the OCR pipeline — the most failure-prone part of the codebase —
has no end-to-end test coverage in CI.

**Why it's debt.**
OCR is the most likely place for regressions: a Tesseract upgrade,
a font tweak, an image-decoding library change can all break
parsing without breaking any unit test. The golden files exist
locally (or on the maintainer's machine) but their absence from CI
means changes to `pkg/parser/` don't have a regression net beyond
the per-function unit tests.

**Mitigation plan.**

1. **Curate a small fixture set** suitable for committing to the
   repo: 4–6 PNG fixtures covering each screenshot type (rank, summary,
   personal, scoreboard), plus 1–2 edge cases (multi-hero, undated).
   Total maybe 5–10 MB.
2. License/permission: confirm the maintainer's own screenshots are
   OK to ship under Apache-2.0. (Game screenshots are user-
   generated content; Blizzard's policy historically permits non-
   commercial sharing.)
3. Drop the fixtures into `pkg/parser/testdata/golden/` with
   sibling `.golden.json` files (already the convention).
4. Update `integration_test.go` to default `RECALL_FIXTURE_DIR` to
   `pkg/parser/testdata/golden` when unset, rather than skipping.
5. Wire into `make test` and `ci.yml`.
6. Add `make update-goldens` (currently `RECALL_FIXTURE_UPDATE=1`
   exists — promote to a Makefile target).
7. Tesseract version matters: CI must install the same version as
   the dev environment, else golden text diverges. Pin via
   `tool-versions.env`.

**How large.**
M. ~½ day for the fixture curation + Makefile wiring + CI step.
Tesseract version pinning is the main risk — if the OCR output is
sensitive to Tesseract patch versions, this could flake. Mitigate
by tolerance-matching the JSON (skip whitespace-only diffs, allow
±1 on numeric fields where OCR confidence is borderline).

---

## 13. `App.vue` directly imports four view SFCs but is also a router

**Size: S**

**What.**
`App.vue` does `import IngestView from './components/IngestView.vue'`
etc., then mounts one of four with `<XxxView v-if="view === '…'" />`.
The four view files are imported eagerly even though only one is
ever visible at a time.

**Why it's debt.**

- Initial bundle includes all four view components plus their
  dependencies. The bundle-size budget (200 KB JS) is already
  ~156 KB; the four views' templates + scripts aren't tiny.
- A new view (e.g. a future "Replay" tab) costs initial-load size
  proportional to its complexity, not "complexity if the user
  visits it".
- Vite supports `defineAsyncComponent` + dynamic imports
  trivially — but there's no test ensuring views are lazy-loaded,
  so it's easy to regress.

**Mitigation plan.**

1. Convert each `import IngestView from './components/IngestView.vue'`
   to `const IngestView = defineAsyncComponent(() => import('./components/IngestView.vue'))`.
2. Run `npm --prefix frontend run build`. Verify each view becomes a
   separate JS chunk in `dist/assets/`.
3. Add a Vitest test that asserts the dynamic import path exists in
   the source (regex over App.vue), to prevent regression.
4. Update the bundle-size budget step in `ci.yml` to optionally
   enforce that initial JS (the `index*.js` chunk only) is < a
   tighter budget — say 120 KB.

**How large.**
S. ~2 hours. Negligible risk — async components are a Vue-3
first-class pattern.

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

## 15. `screenshotType()` ordering is order-dependent

**Size: S**

**What.**
`pkg/app/app.go::screenshotType` checks: rank → summary → scoreboard
(E/A/D) → personal (hero stats) → unknown. CLAUDE.md flags: "must
check E/A/D before hero stats" because scoreboard parses populate
both — hero-stats-first would mis-classify every scoreboard with a
populated panel as `personal`.

**Why it's debt.**
The ordering is correct, but the constraint is enforced only by
comment + tribal knowledge. A future refactor that "tidies up" the
chained `if`s (e.g. by switching to a `slices.IndexFunc` over a
slice of probe-pairs) could reorder them silently.

**Mitigation plan.**

1. Add a test in `pkg/app/`'s test files that constructs a
   `MatchResult` with **both** populated `Eliminations` and
   `HeroesPlayed[*].Stats` and asserts `screenshotType` returns
   `"scoreboard"`, not `"personal"`.
2. Add a comment block above `screenshotType` documenting the
   constraint with the test name, so a future refactor that needs
   to break the order sees what it'd break.

**How large.**
S. ~30 minutes. Self-contained test addition.

---

## 16. `recall` binary committed at repo root (22 MB)

**Size: S**

**What.**
`ls -la` shows a 22 MB executable named `recall` at the repo root,
dated 2026-05-17. Git status reports the tree clean — so it's
either in `.gitignore` or was never staged. Likely a dev artifact
of a manual `go build`.

**Why it's debt.**
Not debt if it's gitignored. But its presence:

- Confuses new contributors ("is this the right binary to run?
  why isn't it under `dist/`?")
- Bloats the workspace.
- Risks accidentally being staged if `.gitignore` ever drifts.

**Mitigation plan.**

1. Confirm via `git check-ignore -v recall` that it's ignored.
2. Add an explicit `# Stray dev builds at repo root` section to
   `.gitignore` covering `/recall`, `/recall-server`, `/recall.exe`,
   `/Recall.app/`.
3. Add a `make clean-bin` (or extend `make clean`) target that
   removes them, so contributors have an explicit cleanup path.

**How large.**
S. ~15 minutes.

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

### Phase 1 — drift prevention (1 week, mostly S items)

1. ~~#8 Go coverage floor ratchet (S)~~ — done
2. #15 screenshotType ordering test (S)
3. #11 inference invariant test (S)
4. #16 .gitignore stray binaries (S)
5. #9 SHA-pin GitHub Actions (M)

### Phase 2 — guard rails (1 week, M items)

1. #4 wailsjs models.ts CI guard, short-term form (M)
2. #6 prepare-go-build composite action (S)
3. #13 lazy-load view components (S)
4. #12 commit golden-file fixtures + CI integration (M)

### Phase 3 — structural refactor (2–3 weeks, L items)

1. #2 split `pkg/app/app.go` into per-concern files (L)
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
