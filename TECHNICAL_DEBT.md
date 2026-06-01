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
> 3. ~~Fix the **`match_key` colon-string footgun** (item 3)~~ —
>    **paid down**: replaced `:` with `-` throughout. New format
>    is `match-YYYY-MM-DDTHH-MM-SS` / `unmatched-<filename>` /
>    `ambiguous-<filename>`; the whole key is URL-safe without
>    encoding. One-time SQL migration in `NewSQLStore` rewrites
>    legacy colon-form rows on startup (idempotent).
>    `frontend/matchTime()` rewrites the `-` time separators back
>    to `:` for display. `feat!:` declared.
> 4. Lift coverage on **App.vue + api.ts + MatchDetailPanel**
>    (item 6) — the highest-traffic surfaces have the thinnest
>    safety net.
>
> Pre-1.0 there's no backwards-compat constraint, so items 2, 3,
> and 4 can ship with breaking changes if that's the cleaner path
> — declare via `feat!:` per CLAUDE.md.

---

## 4. Schemathesis: two excluded checks remain

**Where:** `scripts/check-api-drift.sh`.

Three of the five previously-excluded checks are now enabled:
`missing_required_header`, `use_after_free`,
`ensure_resource_availability` — they pass cleanly against the
current API surface. `--exclude-method DELETE` is also gone (the
test server runs in an isolated HOME, so a DB-wiping DELETE is
safe). Two checks stay excluded:

1. **`positive_data_acceptance`** — the server accepts lenient
   JSON several setters' specs tighten. Real contract gap;
   tracked here in case a future change to either side makes the
   gap easier to close.
2. **`unsupported_method`** — `transfers` and `active` path
   segments collide with the `{matchKey}` / `{name}` wildcards
   on the same level of the Go 1.22 ServeMux, so a `DELETE
   /api/v1/profiles/transfers` routes to the wildcard handler
   instead of returning 405. Closing this needs mux
   disambiguation across several routes — out of scope for the
   schemathesis hardening but worth doing standalone.

**Plan:**

1. For `positive_data_acceptance`, audit the spec's `required`
   declarations against what each handler actually accepts; for
   each pair tighten the handler or loosen the spec.
2. For `unsupported_method`, pull `transfers` and `active` out
   of the wildcard namespace (e.g. dedicated registrations
   ordered before the wildcard, or sub-mux groupings).

**Size:** M per check.
**Risk:** Low (each gap surfaces as a contract-spec mismatch the
fuzzer reports; no runtime behaviour change).

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

1. ~~Stage 2: Add `pkg/app/sse_test.go`~~ — **shipped**: 6 cases
   covering subscribe / broadcast / broadcast-with-data /
   unsubscribe-closes-channel / slow-consumer-drops /
   concurrency-safe. `pkg/app/sse.go` from 0 % to ~95 %.
2. Stage 1: write SFC tests for the four highest-traffic
   surfaces (`App.vue`, `MatchDetailPanel`, `MatchScreenshotLightbox`,
   `MatchCardExpanded`). Each gets 10–15 cases driving observable
   contract: open/close, paginate, error states, keyboard.
3. Stage 3: Add a `pkg/cmd/server_smoke_test.go` that boots a
   real `*App` with a temp store, fires the standard route set
   via httptest, asserts the mux wiring + middleware ordering.
4. Bump the Go threshold from 46 % → 60 % once Stage 3 lands.

**Size:** L (cumulative; Stages 1 + 3 still remaining).
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

0. ~~Extract `useArchiveSelection` composable~~ — **shipped**:
   archive-drawer selection state + bulk-action handlers moved
   to a dedicated composable with 11 unit tests. MatchesView lost
   ~70 lines of inline state; the template + scoped styles
   still live there. Sets up the seam for step 3 to extract
   the full SFC without re-shaping the state contract.
1. Extract `MatchesDossier.vue` (the active-clause chips + W/L/D
   tile + top-3 maps/heroes). Move the dossier-specific styles
   out of MatchesView's scoped block.
2. Extract `MatchesNarrowPanel.vue` (the left-side filter modal).
   Already self-contained; the only state coupling is the
   `useMatchesNarrow` bundle passed as a prop.
3. Extract `MatchesArchiveDrawer.vue` (the hidden-matches
   collapsible at the bottom + bulk Unhide / Delete forever).
   The state contract is already factored out (step 0); this
   extraction is now just template + scoped CSS.
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

## 13. No real desktop-runtime e2e for Wails

**Where:** `frontend/tests/e2e/` still exclusively drives the
serveronly binary. Steps 1 + 2 of the original item 13 plan are
shipped (`make smoke-wails` compile-check + `pkg/cmd/middleware_test.go`
unit coverage of the AssetServer shim), so the dev-mode SPA-fallback
class of bug is now lit up by unit tests.

**What's still invisible:** the `EventsOn` / `EventsOff` runtime
bridge, the native dialog calls (`PickScreenshotsDir` /
`PickTesseractBinary`), the file-system watcher's interaction with
the real OS. Bugs in those still surface only on the released
desktop app.

**Plan (step 3 of the original ladder, deferred):** integrate a Wails
runtime driver (e.g. `wails dev` + `playwright connect` over CDP to
the embedded WebView). Cross-platform-fragile and XL effort — wait
until one of the EventsOn / file-watcher / native-dialog regressions
actually bites before paying this cost.

**Size:** XL.
**Risk:** High.

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
