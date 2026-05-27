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

## 3. 0% unit coverage on scoreboard-geometry helpers

**What.** Four pure functions in `pkg/parser/parse_scoreboard.go`
take an `image.Image` and do pixel-level region detection:
`findHighlightedRowY`, `ocrRowCells`, `findRowXExtent`,
`findStatColumns`. All four sit at 0% unit coverage. They're
exercised by golden-file integration tests, but only across 5
committed PNG fixtures in `testdata/`, so a regression in (say) the
highlighted-row detection only trips when one of those five
specific layouts shifts. Pure helpers `extractHeroes`, `digitize`,
`normalizeDate`, `extractRank`, `extractInts`, etc. are all at
85-100%, so the gap is concentrated in image geometry.

**Why this matters.** These four functions hold the "find the
brightest blue row" + "find the columns between this and that x
extent" heuristics that decide what part of a screenshot is read
for E/A/D/dmg/heal/mit. A single off-by-N change ripples into every
scoreboard match's stats — silently, because the golden test only
asserts the final integer values, not the intermediate rectangles.
A regression here would only be caught by a contributor noticing
the wrong numbers in their own UI. Crafted image fixtures (e.g. a
100×100 PNG with one row painted `#5b95c5`) can drive the helpers
without Tesseract and pin the geometry contract.

**Plan.**

1. Add a `pkg/parser/imageutil_test.go` (already exists — extend it)
   that builds `image.RGBA` test fixtures inline via
   `image.NewRGBA` + `Set(x, y, color.RGBA{...})`. Pattern matches
   what `extractHeroes_test.go` does for text-only tests.
2. `findHighlightedRowY`: paint a 200×100 image with a 10-pixel-tall
   `#5b95c5` band at y=40–50; assert the returned `(yTop, yBot)` is
   `(40, 50)` (or whatever the function's intended return).
3. `findRowXExtent`: paint the same band only across `x=30..170`;
   assert `(xLeft, xRight) = (30, 170)`.
4. `findStatColumns`: paint six evenly-spaced bright cells in the
   row band; assert the returned `[]image.Rectangle` has 6 entries
   with the expected x-ranges.
5. `ocrRowCells` shells out to Tesseract — out of scope for unit
   tests; leave at integration-coverage. (Or, gate it behind a
   `runTesseractFunc` package-level seam the way `parser.go` already
   does for `parseSingleFunc`.)

Each step is a single test function; lands incrementally in one PR.

**Size.** **M** (~3-4 hours, mostly fixture-painting + assertion
boilerplate).

---

## 4. 7-way duplication of the persisted-preference composable shape

**What.** `useTheme`, `useWeekStart`, `useIncludeUndated`,
`useDensityMode`, `useLeaverHandling`, `useMinPlayThreshold`, and
`useShowHidden` all implement the same five-line pattern: a `ref`
seeded with a default, an `onMounted` reader that hydrates from
`localStorage` (try/catch wrapped), a setter that writes both the
ref and `localStorage`, and an exported `readStoredXxx()` helper
for testing the read path without Vue lifecycle.

CLAUDE.md cites these explicitly as a "persisted-preference family"
of seven. The pattern has earned an abstraction (we passed the rule
of three around `useShowHidden` and didn't extract).

**Why this matters.** Every new persisted preference (the next
feature in `FEATURES.md` — saved filter presets, high-contrast
theme, command-palette state — could all want one) currently means
copy-pasting 30 lines, exporting one more storage key, and writing
one more 5-test suite that asserts the same four cases (default,
"true" stored, "false" stored, unrecognized stored, throws). The
test-file boilerplate alone is ~600 lines across the seven
composables. A factory collapses this to a one-line call per
preference.

**Plan.**

1. Land `frontend/src/composables/usePersistedRef.ts` with shape:

   ```ts
   export function usePersistedRef<T>(
     key: string,
     defaultValue: T,
     serialize: (v: T) => string = String,
     parse: (raw: string) => T | undefined,
   ): { value: Ref<T>, set: (next: T) => void, readStored: () => T }
   ```

   `readStored` is exported off the returned object (not as a
   separate named export per preference) so the test surface stays
   uniform.

2. Land `usePersistedRef.test.ts` covering: default-on-unset,
   stored-value-roundtrip, unrecognized-stored-fallback,
   localStorage-throws-fallback, setter-writes-to-storage,
   setter-updates-ref. One file, ~80 lines, replaces the equivalent
   in each of the 7 existing test files.

3. Migrate one composable at a time (smallest first: `useShowHidden`
   → `useIncludeUndated` → `useDensityMode` → `useLeaverHandling` →
   `useWeekStart` → `useTheme` → `useMinPlayThreshold`). Each PR
   deletes the per-composable test file (now redundant) and replaces
   the composable's body with the factory call. Net LOC change per
   PR: −40 to −60 lines.

4. `mountApp.ts`'s `MountOverrides` already accepts the matching
   localStorage keys — no change needed there.

The factory must keep two existing behaviours intact: (a) literal
"true"/"false" string serialization for booleans (so a stored
"false" is distinguishable from unset), (b) silent fallback on
SecurityError / QuotaExceededError from localStorage.

**Size.** **M** (factory + tests + 7 migrations = ~6 hours).

---

## 5. `MatchCard.vue`, `SettingsView.vue`, `FilterRail.vue` are 1200+ lines each

**What.** Three SFCs are each above the 1000-line mark:

| File | Total | `<script>` | `<template>` | `<style scoped>` |
|---|---|---|---|---|
| `MatchCard.vue` | 1849 | 159 | 531 | 1157 |
| `SettingsView.vue` | 1800 | 143 | 621 | 1034 |
| `FilterRail.vue` | 1259 | 136 | 347 | 774 |

**Why this matters.** Each file has multiple distinct concerns that
could reasonably live in their own SFC. `MatchCard.vue` is the
clearest example: the collapsed header (title row + tag row +
badges) is independent of the expanded view (leaver chooser + notes
block + stats grid + sources + danger row). The 1157-line style
block is mostly per-section rules that would naturally scope into
the child SFC. `SettingsView.vue` is six independent panels
(Folders / Engine / Appearance / Calendar / Backup & Restore /
Advanced) glued in one template; each gets ~100 template lines plus
~150 style lines. `FilterRail.vue` has the seven filter popovers,
date range, min-play input, leaver segmented control, hidden
toggle, and Clear/Expand-all controls — at least three extractable
children.

A new contributor opening MatchCard.vue scrolls past 1100 lines of
CSS before finding the template. Vue's reactivity tracking is
unhurt by the size, but the `Go to definition` ergonomics are.

**Plan.** Three independent extractions, each its own PR. Land in
this order (smallest first to prove the pattern):

1. **FilterRail → 3 children.**
   - `MinPlayInput.vue` — the percent + minutes + seconds inputs +
     `min-play-group` shell + 80 lines of scoped style.
   - `LeaverSegmented.vue` — the three-state segmented control +
     ~60 lines of scoped style.
   - `HiddenToggle.vue` / `UndatedToggle.vue` — these share enough
     shape that a single `<TallyToggle>` component with a "kind"
     prop might cover both, but only after looking at whether the
     emit + class differences are stable. Either way: extract.

2. **MatchCard → `MatchCardHeader.vue` + `MatchCardExpanded.vue`.**
   The expansion split is the natural seam — `v-if="isExpanded"`
   already gates the entire bottom half. Header takes the badge
   logic + danger-row collapsed state; Expanded takes the
   annotation/notes/stats/sources/danger-confirmed flow. Style block
   splits cleanly along the same line.

3. **SettingsView → 6 panel children.**
   `SettingsFolders.vue`, `SettingsEngine.vue`, `SettingsAppearance.vue`,
   `SettingsCalendar.vue`, `SettingsBackupRestore.vue`,
   `SettingsAdvanced.vue`. Each panel becomes a self-contained
   `<section>` with its own scoped styles. `SettingsView.vue`
   becomes a ~150-line shell that emits prop/event wiring.

Each step must keep the existing test surface green; Vitest fixtures
already mount via `mountApp({ ... })` so child SFCs ride for free
as long as no event name changes.

**Size.** **L** total (M per extraction × 3).

---

## 6. Two fakeStore implementations will drift

**What.** `pkg/app/store_integration_test.go` and
`pkg/cmd/server_test.go` each define their own `fakeStore` struct
that implements `db.Store`. Both are 16 methods now; any new method
added to the `Store` interface must be added to both. The two
implementations differ — the `pkg/app` one is in-memory with
`sync.Mutex` and per-table slices for actual fixture-driven tests;
the `pkg/cmd` one is bare (all returns are `nil` / empty maps,
methods just track call counts).

**Why this matters.** Two recent feature PRs (match annotation,
match deletion) had to add the new Store method to both files,
once with real state, once with a stub. A future PR that adds a
new Store method but only updates one of the fakes will compile
(both files are in different packages, and the `var _ db.Store =
(*fakeStore)(nil)` assertion lives only in `pkg/app`) — the
`pkg/cmd` fake will silently lose its `Store` conformance. The
compile error surfaces only when someone tries to wire that fake
through `app.NewWithStore(fs)`.

**Plan.**

1. Create `pkg/db/dbtest/` package — exports `NewFake() *Fake` and
   `Fake` struct with all interface methods. Bare-stub behavior by
   default (the `pkg/cmd` shape); fixture-driven behavior toggleable
   via setters (`fake.SeedSummaries(...)`, `fake.SetHidden(...)`).
   Single `var _ db.Store = (*Fake)(nil)` assertion lives here.
2. Migrate `pkg/cmd/server_test.go` first (smaller surface; trivial
   substitution). PR shows the fake's full surface.
3. Migrate `pkg/app/store_integration_test.go` second — its fixtures
   move into `dbtest` as constructor options or stay in the test
   file as `dbtest.NewFake().SeedSummaries(...)` chained calls.

After: one place to update when the Store interface changes; one
compile error if you miss it; one fewer drift vector.

**Size.** **M**.

---

## 7. `api.ts` repeats the Wails-vs-fetch branch 20+ times

**What.** Every void-returning POST in `api.ts` is the same six
lines:

```ts
export function SetX(arg: T): Promise<void> {
  if (IS_WAILS) return _wails('SetX', arg)
  return _post('/api/x', { ... }).then(() => undefined)
}
```

There are ~20 such functions; the `.then(() => undefined)` tail
appears 9 times. The Wails-mode branch and the fetch branch must
stay in sync — the recent 204-handling bug (`_fetch` was throwing
on no-body responses, which silently broke `SetMatchAnnotation` /
`SetLeaverAnnotation` / `SetMatchVisibility` in server mode) was a
direct consequence of a class of bug only the fetch branch can
have.

**Why this matters.** Adding a new endpoint requires touching three
sites (`pkg/app/*.go` method, `api/openapi.yaml`, `api.ts` wrapper).
The third is the most error-prone because of the duplicated
branching, and is the only one that's untyped (the Wails delegate
key is a string literal — `_wails('SetX', ...)` — that can typo
silently). The latent 204 bug shipped through annotations because
no one tested the server-mode path; the same class of bug will
recur with the next 204 endpoint.

**Plan.**

1. Add a thin internal helper:

   ```ts
   function _dualPathVoid<TArgs extends unknown[]>(
     wailsMethod: string,
     fetchPath: string,
     body: (...args: TArgs) => unknown,
   ): (...args: TArgs) => Promise<void>
   ```

   The factory returns a function that branches once on `IS_WAILS`
   at call time — same shape, but written once.

2. Migrate the existing 9 void writers (`SetMatchVisibility`,
   `SetMatchAnnotation`, `SetLeaverAnnotation`,
   `ClearLeaverAnnotation`, `SetScreenshotsDir`,
   `SetPrometheusEnabled`, `SetWatchEnabled`, `ResetTesseractPath`,
   `ClearDatabase`) to use the helper.

3. (Optional follow-up) A second helper for the data-returning
   `GetX` shape collapses ~10 more functions.

The Wails-method-name string remains a typo vector — could be
addressed by generating an `enum` from `api/openapi.yaml`
`operationId` fields, but that's a separate piece of work (and
none of the spec's routes currently carry `operationId` — see
item #8).

**Size.** **S** (~1 hour for the helper + migrations).

---

## 8. Missing tests: `ParseProgressPanel.vue`, `useOWData.ts`

**What.** Two known coverage gaps:

- `frontend/src/components/ParseProgressPanel.vue` is the only SFC
  in `components/` without a `.test.ts` sibling. Coverage shows
  85% statements but **0% functions and 0% branch** — meaning the
  component mounts but no user-action path is exercised.
- `frontend/src/composables/useOWData.ts` has no test file at all.
  Coverage is 64% — the module-singleton fetch path, the
  `heroDisplayName` / `mapDisplayName` lookups, and the
  diacritic-stripping `normalize()` (which mirrors the Go parser's
  normalize and must stay in sync) are all unverified.

**Why this matters.** ParseProgressPanel is the live indicator users
watch during ingest; a regression in its render or its pulse-dot
animation goes unnoticed until a user files a bug. `useOWData` is
the singleton that resolves stored lowercase hero/map keys back to
canonical display names (Lúcio, King's Row) — if its normalize()
drifts from the Go side, every hero with a diacritic or colon
silently displays as the stored lowercase form.

**Plan.**

1. **`ParseProgressPanel.test.ts`** — `mountApp`-style or direct
   `mount(ParseProgressPanel, { props: {...} })`. Cover:
   - Renders the rolling log when `parseLog` has entries.
   - Renders the empty state when `parseLog` is empty.
   - Pulse-dot class is present during active parse, absent
     otherwise.
   - Done/total counter renders correctly.

2. **`useOWData.test.ts`** — exercise the module singleton without
   Vue lifecycle by mocking `GetOWData` via `vi.doMock('../api')`:
   - First call kicks off the fetch; second call shares the cached
     ref.
   - `heroDisplayName("lucio")` returns "Lúcio" after fetch;
     `heroDisplayName("lucio")` returns "lucio" before fetch (the
     graceful-degrade contract).
   - Normalize parity: a sample table of `(input, expected)` pairs
     including diacritics, colons, and mixed-case input — same
     fixtures as the Go side's `normalize` test (so drift is loud
     when either moves).
   - Failure mode: `GetOWData` rejects → consumers fall back to the
     stored lowercase form, no exception bubbles up.

**Size.** **S** (~2-3 hours for both).

---

## 9. OpenAPI routes don't carry `operationId`

**What.** `grep -cE 'operationId:' api/openapi.yaml` returns 0.
Spectral's `spectral:oas` ruleset emits `operation-operationId` as a
warning by default; we suppress it implicitly because we never write
any. Spectral's `--fail-severity=warn` should be failing the lint
job for every route, but we're sidestepping it because the warning
level for `operation-operationId` was downgraded somewhere in the
config chain.

**Why this matters.** `operationId` would (a) enable codegen tools
to pick stable function names, (b) give us a typed enum of Wails
method names instead of the current string literals in `api.ts`'s
`_wails('GetMatchResults', ...)` calls — collapsing the typo vector
called out in item #7, (c) make spec changes easier to grep
across (vs. trying to match `/api/match-results` literal). Adding
them now is cheap; adding them later means coordinating with whatever
code generator we adopt.

**Plan.**

1. Add `operationId` to every operation in `api/openapi.yaml`,
   matching the Wails method name (e.g. `GetMatchResults`,
   `SetMatchVisibility`). Convention: PascalCase, matching `func
   (*App) X` exactly.
2. `make gen-types` to regenerate `api.gen.d.ts`.
3. Verify Spectral lint still passes (it will — adding fields
   doesn't trip any rule).
4. (Follow-up, after item #7's helper lands) the `_dualPathVoid`
   helper could take an `operationId` typed against `operations[K]`
   from `api.gen.d.ts` instead of a string literal, closing the
   typo vector.

**Size.** **S** (mostly spec edits; ~26 routes × one line each =
~1 hour).

---

## 10. App.vue references a `TECHNICAL_DEBT.md #1` that doesn't exist

**What.** `frontend/src/App.vue` line ~8 carries the comment:

> component-specific selectors are tracked for a follow-up
> extraction into per-SFC scoped `<style>` blocks
> (TECHNICAL_DEBT.md #1).

But this file has been empty until now; there was no #1 to follow.
The work the comment refers to — moving per-component selectors out
of `app.css` into the SFC's own scoped `<style>` block — is real
and ongoing (the scoped blocks in MatchCard / FilterRail /
SettingsView are the result of this effort partially completed).

**Why this matters.** A reader following the breadcrumb hits a dead
end. Either delete the reference, or formalise the remaining work
as a numbered item. Cheapest closure: drop the parenthetical.

**Plan.** Either:

1. **Delete** the `(TECHNICAL_DEBT.md #1)` parenthetical from the
   App.vue comment — the surrounding sentence still reads cleanly
   ("component-specific selectors are tracked for a follow-up
   extraction into per-SFC scoped `<style>` blocks."). Atomic 1-line
   edit; ship in any PR that already touches App.vue.

2. **Or**, if there's residual `app.css` rule extraction worth
   tracking, expand into a numbered section here, listing the
   specific `.match-*` / `.filter-*` / `.settings-*` selectors still
   in `app.css` that should move.

**Size.** **S** (literally one line, in either direction).
