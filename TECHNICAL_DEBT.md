# Technical Debt

Living inventory of known technical debt in the Recall codebase. Each
item has the same five-section shape so they can be triaged, scoped,
and worked off independently. Update this file whenever debt is added
(record it the same week, with the same rigor) or paid down (delete
the section — not "strikethrough", not "✅", just delete it; git
history is the audit trail).

## How to read this file

Each item carries two estimates — **size** (coding effort + review
surface) and **risk** (what could break) — so triage can favour
items with low cost AND low blast radius first.

| Size | Rough effort | Examples |
|---|---|---|
| **S**  | < 2 hours | A single-file rename, one Makefile var, one config flip. |
| **M**  | ½–2 days | A refactor inside one package; new test file; small DI seam. |
| **L**  | 2–5 days | Multi-package refactor; new abstraction with migrations; CI rewiring. |
| **XL** | 1–2 weeks | Rewriting a monolith; introducing a new runtime dependency; reshaping an entire layer. |

| Risk | What "breaks" means here |
|---|---|
| **Low**  | Local refactor; if it slips, the diff is small and lint/test catch it. |
| **Med**  | Touches multiple layers or a shared abstraction; CI may not catch everything; needs careful staging or a feature flag. |
| **High** | SQLite schema, on-disk format, public URL shape, or build-tag-conditioned behaviour. Mistakes can corrupt user data or strand existing installs. |

A **plan** is a sequence of *small, independently mergeable* steps.
If a step needs a release or a contributor handoff, that's marked in
line. Anything that has to land atomically is called out.

The list is ordered by *risk × cost-to-fix-later*, not by size. The
top items are the ones most likely to bite if left alone. Pay them
off first.

> **Next release focus** (per the maintainer's working note):
>
> 1. ~~Burn down the **skipped e2e suites** (item 1)~~ — **paid
>    down**: 10 describe-blocks across 6 specs un-skipped and
>    rewritten against the current UI; surfaced + fixed two
>    production bugs (heatmap date-format mismatch dropping every
>    record, `/` shortcut targeting a removed `#match-search`
>    element).
> 2. ~~Fix the **ScreenshotHandler dir-ID bug** (item 2)~~ —
>    **paid down**: took the pre-1.0 break path. URL shape moved
>    from `/_screenshot/<filename>` to
>    `/_screenshot/<dir-id>/<filename>`. `MatchRecord.source_dirs`
>    (paths) replaced by `source_dir_ids` (integers); the handler
>    looks the path back up via `db.Store.LookupScreenshotsDir`
>    and falls back to the configured dir when dir-id is 0
>    (unparsed files in the watched folder). `feat!:` declared.
> 3. Lift coverage on **App.vue + api.ts + MatchDetailPanel**
>    (item 6) — the highest-traffic surfaces have the thinnest
>    safety net.
>
> Pre-1.0 there's no backwards-compat constraint, so items 2, 3,
> and 4 can ship with breaking changes if that's the cleaner path
> — declare via `feat!:` per CLAUDE.md.

---

## 3. `match_key` colon-string footgun in URL paths

**Where:** `match_key` is `match:<ISO>` or `unmatched:<filename>`.
Every consumer that embeds it in a URL has to remember to
`encodeURIComponent` it (raw `:` splits in many parsers). CLAUDE.md
documents the gotcha but it's still an active footgun:
`frontend/src/api.ts` route builders, every Playwright `page.route()`
glob, and any future tooling that hits the API directly.

**Plan:**

Pre-1.0 break: promote the integer `id` (already on every parent
row, currently API-private) to the canonical identifier. Keep the
`match_key` field as the human-readable trace label, but route
URLs by id. Three steps:

1. Add an opaque `id` field to every `MatchRecord` in the API.
2. Add `/api/v2/matches/{id}/…` alongside `/api/v1/matches/{matchKey}/…`,
   ramp the frontend, then drop v1.
3. Drop the colon-encoding rule from CLAUDE.md.

(Smaller alternative if v2 is too heavy: keep colons but
URL-encode them server-side and accept both forms — but that adds
its own parser-ambiguity surface, so probably worse than the
status quo.)

**Size:** L.
**Risk:** Med — versioned migration; old PR scripts / curl
recipes break; the integration tests + schemathesis matrix
doubles.

---

## 4. Schemathesis exclusions (5 v4 checks + DELETE method)

**Where:** `scripts/check-api-drift.sh:164`.

```bash
--exclude-checks unsupported_method,positive_data_acceptance,\
                 missing_required_header,use_after_free,\
                 ensure_resource_availability \
--exclude-method DELETE \
```

Each exclusion documents a real spec / server gap, deferred for
"its own dedicated PR" — none of which have landed.

**Plan** (one PR per check):

1. **`positive_data_acceptance`** — server accepts lenient JSON
   the spec tightens. Tighten the spec (the easier path) OR
   loosen the validators. Concrete cases: nullable strings the
   server accepts but the spec marks `required`.
2. **`unsupported_method`** — `transfers` + `active` path segments
   collide with `{matchKey}` + `{name}` wildcards. The Go 1.22
   ServeMux routes `DELETE /api/v1/profiles/transfers` to the
   wildcard handler (a no-op delete with a 4xx body) instead of
   the 405 the spec demands. Disambiguate by pulling `transfers`
   and `active` out of the wildcard namespace.
3. **`missing_required_header`**, **`use_after_free`**,
   **`ensure_resource_availability`** — not yet evaluated. Run
   once, document each finding, fix or excuse.
4. **`--exclude-method DELETE`** — DELETE on `/matches` and
   `/profiles/{name}` would wipe the live test server's state.
   Fix: the schemathesis harness already runs against an isolated
   `HOME=$tmp` install (`scripts/check-api-drift.sh:101`). Just
   stop excluding DELETE; the worst case is the test server
   wipes its own scratch DB, which is fine.

**Size:** M per check (the five together are L).
**Risk:** Low (each gap surfaces as a contract-spec mismatch the
fuzzer reports; no runtime behaviour change).

---

## 5. Bundle-size budgets keep ratcheting up; no pruning loop

**Where:** `scripts/check-bundle-size.sh:34`.

| | Initial JS | Total JS | Total CSS |
|---|---|---|---|
| **Start** | 130 KB | 250 KB | 120 KB |
| **Today** | **140 KB** | **320 KB** | **180 KB** |
| **Headroom now** | ~190 B (135 / 140 KB after current PR set) | 4.5 KB | 4.6 KB |

The initial JS chunk sits at 99.86% of its budget after the
latest features. One more 200-byte addition tips it over. Every
PR that has had to bump it has done so as a one-line "deliberate
bump" — but the trend is monotonic; nothing in CI prunes.

**Plan:**

1. Audit the initial chunk with `npx vite-bundle-visualizer` (or
   any analyser). Big surface candidates in App.vue:
   - the localStorage-key duplication (workaround for
     keeping the tour controller out of the initial chunk) —
     extract a tiny `src/composables/storageKeys.ts` (single
     literal file) so both readers import the same source of
     truth without dragging the rest of `useOnboardingTour`.
   - The five static-imported "small modals" (parse chip,
     skeleton, etc.) — re-evaluate which actually need to be in
     the initial chunk; lazy-load anything not visible on first
     paint.
2. Reset the budgets to current measurement + 1 KB and require
   PRs to bump explicitly (the existing rule, but enforced from
   a lower floor).

**Size:** M.
**Risk:** Low (lazy-loading bugs are caught by the
`App.lazy-views.test.ts` regression suite).

---

## 6. Coverage gaps on highest-traffic surfaces

**Frontend (Vitest line coverage, `make cover-frontend`):**

| Surface | Lines | Why it matters |
|---|---|---|
| `App.vue` | 43 % | Owns every cross-cutting state ref (records, filters, modals, tour, profile, parse). 1585 lines. Most "what broke this regression" answers live here. |
| `api.ts` | 53 % | Transport layer. The `_fetch` 204/202 short-circuit, the `_dualVoid` helper, the path-builder branches — all undertested. The original `r.json()`-on-204 bug shipped past CI here. |
| `MatchDetailPanel.vue` | 33 % | The right-side slide-out the user spends most of their time in. Modal contract, focus trap, paginator, screenshot lightbox handoff. |
| `MatchScreenshotLightbox.vue` | 51 % | Capture-phase Esc handling, multi-source navigation. |
| `MatchCardExpanded.vue` | 58 % | Source-file list + leaver/tag chips. |
| `useTesseractStatus.ts` | 57 % | The "Detect" button path is e2e-covered but the composable's failure branches are not. |

**Go (line coverage, `make cover-go`):** 64.2 % total; gates at
46 %. The headline is fine but specific zero-coverage hotspots:

- `pkg/app/sse.go` — entire SSEHub at 0 %. Server-mode parse
  events flow through here; no unit test of subscribe / broadcast
  / unsubscribe.
- `pkg/app/app_wails.go` — build-tagged so the serveronly test
  suite can't reach it; the Wails-only methods (`PickScreenshotsDir`,
  `SaveExportToFile`, etc.) are exercised only by the build
  itself.
- `pkg/app/parse.go::ParseScreenshots` — the parse pipeline
  orchestrator at 0 %. The pieces (per-screenshot-type parsers,
  Upsert\*) are tested; the dispatcher isn't.
- `pkg/cmd/server.go::RunServer` — 0 %. Boots an HTTP server +
  wires SSE + mux. No test asserts the wiring shape.

**Plan:**

1. Stage 1: write SFC tests for the four highest-traffic
   surfaces (`App.vue`, `MatchDetailPanel`, `MatchScreenshotLightbox`,
   `MatchCardExpanded`). Each gets 10–15 cases driving observable
   contract: open/close, paginate, error states, keyboard.
2. Stage 2: Add `pkg/app/sse_test.go` covering subscribe/
   broadcast/unsubscribe + the slow-consumer drop case.
3. Stage 3: Add a `pkg/cmd/server_smoke_test.go` that boots a
   real `*App` with a temp store, fires the standard route set
   via httptest, asserts the mux wiring + middleware ordering.
4. Bump the Go threshold from 46 % → 60 % once `sse.go` lands.

**Size:** L (cumulative).
**Risk:** Low (additive; failing tests reveal real gaps).

---

## 7. `MatchesView.vue` is 2 956 lines — split candidate

**Where:** `frontend/src/components/MatchesView.vue`.

The "set workspace" view bundles dossier, Campaign Log timeline,
Narrow panel, members list, bulk action bar, archive drawer, and
the move-to-profile picker. Each surface is independently
understandable but they share the `useMatchesNarrow` /
`useMatchesGroup` / `useMatchesDossier` composables.

**What breaks today:** nothing — the file is shaped but verbose.
The cost is review time and the fact that every change has to
scroll through 3 K lines of unrelated markup. Vitest tests for
MatchesView (`MatchesView.test.ts`) are ~30 cases and load the
whole file each run.

**Plan:**

1. Extract `MatchesDossier.vue` (the active-clause chips + W/L/D
   tile + top-3 maps/heroes). Move the dossier-specific styles
   out of MatchesView's scoped block.
2. Extract `MatchesNarrowPanel.vue` (the left-side filter modal).
   Already self-contained; the only state coupling is the
   `useMatchesNarrow` bundle passed as a prop.
3. Extract `MatchesArchiveDrawer.vue` (the hidden-matches
   collapsible at the bottom + bulk Unhide / Delete forever).
4. MatchesView becomes ~800 lines of orchestration: dossier
   header → timeline → members → archive.

Each step is independently mergeable; commit one extraction at
a time so reviews stay readable.

**Size:** L.
**Risk:** Med — the scoped CSS hashes change per extraction;
any cross-component selector that relied on MatchesView's
`data-v-*` hash needs to follow. The bulk-action-bar +
move-to-profile flow lives in MatchesView today but uses tokens
from `app.css` — those references survive.

---

## 8. `cardState` shared prop is a bag of refs + callbacks

**Where:** `frontend/src/types/cardState.ts` + every consumer
(`MatchesView.vue`, `UnknownMapsView.vue`, `MatchDetailPanel.vue`).

The bundle threads eight unrelated pieces of state through one
prop:

```ts
interface CardStateApi {
  isSelected(id): boolean
  isSourcesOpen(id): boolean
  previewOpen: Ref<Record<string, boolean>>
  previewError: Ref<Record<string, boolean>>
  toggleExpand(id): void
  toggleSources(id): void
  togglePreview(filename): void
  onPreviewError(filename): void
}
```

Two of the fields are unwrapped refs (templates can use
`previewOpen[f]` directly via Vue auto-unwrap) but the other six
are bound functions. Consumers reach into the bundle with
`.value` syntax inside scripts and bare `[]` access inside
templates — a known auto-unwrap gotcha that CLAUDE.md flags. The
prop-bundle pattern was sensible at two consumers; it's now at
three and the per-card behaviour fan-out is growing.

**Plan:**

Split into two narrow APIs:

- `useCardExpand({ kind: 'selection' | 'inline' })` — owns
  isSelected / toggleExpand. The Unknown view uses the inline
  variant; MatchesView uses the selection variant via
  `useSelectedMatch`.
- `useScreenshotPreviews()` — owns previewOpen / previewError /
  togglePreview / onPreviewError. Module-singleton'd so card
  state persists across the tab swap (today's behaviour).

Consumers depend on the narrow API they need; cross-coupled
parameter passing through App.vue goes away.

**Size:** M.
**Risk:** Low — typed seam, vue-tsc catches any caller miss.

---

## 9. Stale `deadcode-allow.txt` entries

**Where:** `scripts/deadcode-allow.txt:38-46`.

```text
App\.SetLeaverAnnotation
App\.ClearLeaverAnnotation
```

These methods no longer exist on `*App` in `pkg/app/`. The
allow-list entries were added when the methods were "kept for
back-compat" but the cleanup that removed them never updated the
allow file. Current `deadcode` runs ignore them silently because
nothing in the call graph matches.

**Plan:** delete the two lines. Run `make dead-code-go` to
confirm no regressions.

**Size:** S.
**Risk:** Low.

---

## 10. No SQLite migrations framework

**Where:** `pkg/db/db.go::schemaStatements`.

Schema evolution today is `CREATE TABLE IF NOT EXISTS` plus
`ALTER TABLE … ADD COLUMN` with "duplicate column" errors
swallowed. That works for one-way additive changes; it can't:

- Drop a column (SQLite needs the create-temp / copy / swap
  dance pre-3.35).
- Add a `NOT NULL` column without a default.
- Rename a column safely across versions.
- Track which migrations have run (no schema_version table).

**Why it hasn't bit yet:** pre-1.0, breaking changes are allowed.
The "delete the DB and re-parse" recovery path is acceptable for
beta users.

**Plan (do this BEFORE 1.0):**

1. Add a `schema_version` table; seed at the current version.
2. Adopt `golang-migrate` (or a 50-line homegrown version —
   `pressly/goose` is the established midpoint).
3. Per-version migrations live in `pkg/db/migrations/*.sql` with
   `up` / `down`. `Init()` runs `up` migrations in order; CI
   asserts every `up` has a paired `down`.
4. Document the upgrade path in `RELEASES.md`.

**Size:** L.
**Risk:** High — once the first migration ships, the schema is
contractually stable. Get the framework right before the first
real migration.

---

## 11. Export schema has one version + no migration path

**Where:** `pkg/app/export.go:50` — `const exportSchemaV1 =
"recall-export/v1"`.

The export format is hand-versioned but the codebase carries
only the v1 reader. When the schema evolves the reader has to
either grow a switch on `Schema` (the typical path) or hard-fail
on legacy versions. Today's import logic does the latter — any
non-v1 payload is rejected outright.

**Plan:**

1. Refactor `ImportData` to dispatch on `Schema` first, then
   call a per-version unmarshaller. v1 is the only entry today.
2. When v2 is needed, add a `migrate_v1_to_v2(v1) (v2, error)`
   helper. The reader always accepts v1; the migrator hoists it
   into v2 in-memory before writing.
3. Add a CI test that loads the canonical v1 fixture (the
   pre-1.0 exports the maintainer has on disk) and asserts the
   reader accepts it without modification.

**Size:** M.
**Risk:** Med — the import path is a destructive replace
(`store.Clear()` first), so a regression here can wipe a user's
DB without recovery.

---

## 12. Two parallel "open the lightbox" paths

**Where:**

- `MatchDetailPanel.vue` → `togglePreview(f)` flips
  `cardState.previewOpen[f]` → `<img class="source-preview">`
  renders → click opens the lightbox.
- `UnknownMapsView.vue` → same toggle path inside the expanded
  card.
- `UnknownMapsView.vue` → the new floating hover thumb
  Teleport'd to body, with its own cursor-tracking state.

Three independent ways to surface a screenshot, each owning its
own state machine. The hover thumb's preload of `source_files[0]`
warms the cache the in-card preview also relies on, but the
consumers don't know about each other.

**Plan:**

Consolidate into a single `useScreenshotPreview()` composable:

- `peek(filename)` — float a cursor-anchored thumb (today's
  hover thumb behaviour).
- `expand(filename)` — pin a same-position thumb open
  (today's `previewOpen[f]` toggle).
- `lightbox(filename, files)` — fullscreen modal (today's
  `emit('open-lightbox', …)`).

Each consumer asks for the gesture it wants; the composable
handles cache warming, request deduping, and the click→escalate
path (peek → expand → lightbox).

**Size:** M.
**Risk:** Med — the lightbox keyboard contract (capture-phase
Esc) is sensitive to event registration order; the consolidation
has to preserve it. The existing lightbox e2e + the new hover
spec lock the contracts.

---

## 13. No e2e covers the Wails desktop runtime

**Where:** `frontend/tests/e2e/` exclusively drives the
serveronly binary. The Wails dev / production binary has zero
browser-level coverage.

**What's invisible:** the AssetServer Middleware shim for
`/_screenshot/`, the `EventsOn` / `EventsOff` runtime bridge,
the native dialog calls (`PickScreenshotsDir` /
`PickTesseractBinary`), the file-system watcher's interaction
with the real OS. Bugs in any of these surface only on the
released desktop app.

**Plan:**

This is genuinely hard. Wails doesn't ship a Playwright-style
harness. Options, from cheapest to most ambitious:

1. **Smoke-mode**: a `make smoke-wails` target that builds the
   desktop binary, boots it headlessly with a temp HOME, and
   hits the AssetServer at `:34115` via curl. Catches the
   "did it boot" class of bugs. (S, Low)
2. **AssetServer middleware coverage**: write unit tests in Go
   that exercise the screenshot Middleware in isolation
   (`ScreenshotHandler()` already has these; expand to cover
   the dev-mode SPA-fallback path documented in CLAUDE.md). (S, Low)
3. **Real desktop e2e**: integrate a Wails runtime driver
   (e.g. via `wails dev` + `playwright connect over CDP` to
   the embedded WebView). Cross-platform, fragile. (XL, High)

Steps 1 + 2 are the realistic next-release targets.

**Size:** S–XL depending on ambition.
**Risk:** Low for steps 1–2; High for step 3.

---

## 14. Two distinct loading refs in App.vue (`loading` vs `initialLoading`)

**Where:** `frontend/src/App.vue:125-132`.

```ts
const loading = ref(false)          // parse-button busy
const initialLoading = ref(true)    // first /api/v1/matches roundtrip
```

Added together but distinct enough that the call sites are
already confusing them. `loading` flips true during `runParse()`
(manual parse click), `initialLoading` flips false once the first
`load()` resolves. The Matches skeleton gates on `initialLoading
&& records.length === 0`; SettingsView still receives `loading`
as a prop and doesn't get `initialLoading`.

**Plan:**

Rename + document. `loading` → `parseBusy`, `initialLoading` →
`firstLoadPending`. Audit every consumer to confirm they want
the right semantics; SettingsView's disabled-during-load buttons
should probably switch to `parseBusy`.

**Size:** S.
**Risk:** Low.

---

## 15. Onboarding flag key duplicated in two places to keep tour out of initial chunk

**Where:** `frontend/src/App.vue` inlines the literal
`'recall.onboardingCompleted'` (with a comment explaining why),
while `frontend/src/composables/useOnboardingTour.ts` exports the
same constant as `ONBOARDING_COMPLETED_KEY`. Importing the
constant from App.vue would pull the whole tour controller into
the initial JS chunk, defeating the lazy-load.

**Plan:**

Extract the key constants into a 5-line
`frontend/src/composables/storageKeys.ts` module (no dependencies,
no side effects). Both App.vue and useOnboardingTour import from
there. Bundler tree-shaking keeps the import cheap.

**Size:** S.
**Risk:** Low (lazy-views test guards against the bundler
regression).

---

## 16. Settings/Profiles destructive action is gated by localStorage, not server state

**Where:** `frontend/src/composables/useFirstRunAcknowledged.ts`
and the `recall.firstRunAccountNamed` flag.

The first-run "Main account name" modal records its dismissal in
localStorage. That binding is per-browser-profile and per-device.
A user who:

- Clears browser storage,
- Switches browsers in server mode,
- Reinstalls the desktop app on a new machine,

will get the modal again even if they've already named their
profile. The modal's "the profile is still named 'main'" check
doesn't exist — it relies entirely on the flag.

**Plan:**

Skip the modal if the active profile's name is anything other
than the default (`main`). The composable already has the
profile list available via `GetProfiles()` — the gate becomes
`!firstRunAcknowledged && activeProfile === DEFAULT_PROFILE_NAME`.

**Size:** S.
**Risk:** Low — a user who legitimately names their profile
"main" still gets the modal on first launch; subsequent launches
either pick up the localStorage ack or, if missing, see the
profile is still "main" and re-show the modal. Acceptable.

---

## 17. Metrics filter is hard-coded; no test of the boundary

**Where:** `pkg/metrics/metrics.go::Collect` — drops every row
where `r.Mode != "competitive"`. The filter is documented in
CLAUDE.md as "the only place modes are filtered for Prometheus,"
but there's no Go test of the filter itself.

**Plan:**

Add `pkg/metrics/metrics_filter_test.go` that:

1. Boots a metrics collector with a stub Reader returning
   mixed competitive / quickplay / arcade records.
2. Calls `Collect` and inspects the emitted samples.
3. Asserts only competitive rows produced samples.
4. Pins the contract — any future "expand which modes count"
   change has to update the test alongside.

**Size:** S.
**Risk:** Low.

---

## 18. j/k keyboard nav walks `narrowedRecords` ignoring the rendered sort order

**Where:** `frontend/src/App.vue` j/k handlers + `MatchesView.vue`
`narrowedIndexByKey` computed.

After paying down item 1, the j/k keyboard nav was repaired so it
walks `matchesNarrow.narrowedRecords` (instead of the now-defunct
`filters.filteredSorted`). MatchesView's leaf-rows carry
`data-card-index` matching their position in `narrowedRecords`.
That works for the default `sortOrder='newest'` because both
orders coincide for a date-descending corpus.

When the user flips Sort → Oldest (or the upcoming "by hero" /
"by map" sorts), the rendered order diverges from
`narrowedRecords` order. `j` then advances to a row that's NOT
the visually next one. The aria-current attribute still lights up
the correct row, but the user's mental model breaks.

**Plan:**

Move the keyboard handlers (or at least the j/k/e/t set that
depend on the rendered list) into MatchesView. The view owns
`sortedRecords` and can index against the rendered order
directly. App.vue keeps only the global shortcuts (`?`, `/`, the
`g`-prefix view nav).

**Size:** M.
**Risk:** Low — typed seam between App.vue and MatchesView; the
keyboard-shortcuts e2e covers the contract.

---

## 19. `useMatchFilters.matchQuery` is dead but its `searchClauses` still feed the hit-highlighter

**Where:** `frontend/src/composables/useMatchFilters.ts:71`
exports `matchQuery` and a `searchClauses` computed parsed from
it. The narrow-panel search lives on `useMatchesNarrow.searchText`
and writes nowhere else. `matchQuery` is never written outside
`reset()` — meaning `searchClauses.value.length` is always 0.

`MatchCardExpanded.vue` reads `searchClauses` to build the
`mark.note-hit` highlight markup. With no clauses ever produced,
the highlight branch is unreachable: typing a query in the narrow
panel narrows the list but doesn't highlight hits inside the
expanded note preview.

This is why the pre-redesign `match-notes-search.spec.ts`
hit-highlight tests stayed skipped through the item-1 burn-down —
the feature is wired but dead. The current spec only covers the
preview / textarea swap.

**Plan:**

Wire `matchesNarrowState.searchText` → `filters.matchQuery` via
a one-line watcher in App.vue. Or simpler: drop `matchQuery` from
`useMatchFilters` entirely and have `MatchCardExpanded` accept the
search term as a prop from MatchesView (which already owns
`searchText`). Either way, re-arm the hit-highlight tests once
the wiring lands.

**Size:** S.
**Risk:** Low — the highlight is a passive render branch; wiring
it up can't break the existing substring filter.

---

## How to add a new entry

When you find debt, capture it the same week with the same shape:

```markdown
## N. Short headline — what's broken in one phrase

**Where:** file:line + a sentence explaining the surface area.

**What breaks:** one paragraph; concrete user-visible or
contributor-visible failure mode. Avoid "this is ugly" framings —
articulate the cost.

**Plan:** numbered steps that are independently mergeable.

**Size:** S/M/L/XL.
**Risk:** Low/Med/High.
```

Keep the numbering stable across edits — gaps in the sequence are
fine, never renumber. When a section is paid down in full,
*delete* it; the git log is the audit trail.
