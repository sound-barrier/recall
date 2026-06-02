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

## 4. Schemathesis: one excluded check remains

**Where:** `scripts/check-api-drift.sh`.

Four of the five previously-excluded checks are now enabled:
`missing_required_header`, `use_after_free`,
`ensure_resource_availability`, `unsupported_method` —
all pass cleanly. `--exclude-method DELETE` is also gone.

One check stays excluded:

- **`positive_data_acceptance`** — the server accepts lenient
  JSON several setters' specs tighten. Real contract gap; the
  fix is a per-handler boundary-validate pass that reuses the
  existing app-layer validators (`validateScreenshotsDir`,
  `validateTesseractPath`, `validateProfileName`) at the HTTP
  layer so a malformed payload returns 400 before reaching the
  store.

**Plan:**

Audit the spec's `required` + `pattern` declarations against
what each handler actually accepts. For each pair tighten the
handler boundary (errors.Is on a typed `app.Err*` sentinel → 400)
or loosen the spec.

**Size:** M.
**Risk:** Low (the gap surfaces as a contract-spec mismatch the
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
