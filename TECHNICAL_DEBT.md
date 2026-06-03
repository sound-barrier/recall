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

## 1. `pkg/cmd/server.go::NewMux` is 60-complexity (was 95)

**Where:** `pkg/cmd/server.go::NewMux`. Matches resource family extracted to `server_matches.go::registerMatchRoutes`; NewMux dropped from 95 → 60. The remaining 60 covers Profiles, Settings, Parse, Screenshots, System routes still inline.

**What breaks:** the Matches family is now isolated; adding a /matches route edits a focused 350-line file. Other families (Profiles, Settings) still live in NewMux, so the route-monolith problem persists for those.

**Plan:**

1. (Done) Extract Matches family. `server_matches.go::registerMatchRoutes` registers GET/DELETE /matches, POST/transfers, /{matchKey} CRUD, visibility, resolution, annotation, review. NewMux 95 → 60.
2. Extract Profiles family. `server_profiles.go::registerProfileRoutes`.
3. Extract Settings family. `server_settings.go::registerSettingsRoutes`.
4. Extract Parse + Screenshots + System families per the same pattern.
5. Final NewMux should be ~30 lines: instantiate router, fan out.

**Size:** M (remaining). **Risk:** Med — route table is the public API; mistakes silently 404.

## 2. `useMatchFilters`'s main predicate is 85-complexity — REMAINS PARTIALLY

**Where:** `frontend/src/composables/useMatchFilters.ts:142` — still at 85-complexity. The matching predicate in `useMatchesNarrow.ts` has been refactored down to 12 (was 42) by extracting per-dimension helpers into `narrowPredicates.ts`; `useMatchFilters` still uses its own inline form.

**What breaks:** the duplicated filter math now lives in one fully refactored spot (`narrowPredicates.ts`) AND one legacy 85-complexity spot. Adding a dimension touches both, the legacy spot is still a coverage trap, and the original "you can delete `useMatchFilters` if `useMatchesNarrow` covers every consumer" plan can't land until App.vue stops using `useMatchFilters` for the legacy FilterRail UI.

**Plan:**

1. (Done) Extracted per-dimension predicates into `narrowPredicates.ts`. `useMatchesNarrow` now composes them via `every`; 42 → 12.
2. Audit App.vue's `useMatchFilters` consumer. If still load-bearing, refactor it to consume `narrowPredicates` too (the State shape differs — array filters vs Set — so the helpers need an array overload or the call sites need adapter wrappers).
3. Delete `useMatchFilters` when no consumer remains.

**Size:** S (remaining step). **Risk:** Low.

## 3. `match_key` is stringly-typed with sentinel prefixes

**Where:** `pkg/app/correlation.go::resolveMatchKey` mints keys with three shapes: `match:<filename-ts>`, `unmatched:<filename>`, `ambiguous:<filename>`. Every consumer (`SQLStore`, REST handlers, frontend `MatchRecord.match_key`, Prometheus collector) treats it as a bare `string` and re-parses the prefix in-place. The URL-safety break ("colons → dashes") in `pkg/db/migrations` is a permanent migration scar from typing this as `string` instead of a discriminated union.

**What breaks:** every new code path has to remember the prefix convention. A typo at the prefix ships through every layer because the type system doesn't care. The "is this an ambiguous match?" branch lives at three call sites: `match_key.startsWith('ambiguous-')` in `MatchesView.vue`, `UnknownMapsView.vue`, and the server's resolution handler. Adding a fourth identity shape (e.g. a future "merged-match" key) means hunting every `startsWith` site.

**Plan:**

1. Define `type MatchKey = { kind: 'tracked' | 'unmatched' | 'ambiguous'; raw: string }` in Go; add `ParseMatchKey(s string)` + `String()`. Wire through internal call sites first (server boundary stays string-typed against the wire format).
2. Mirror on the frontend: `type MatchKey = { kind: …; raw: string }` + a small `parseMatchKey()` helper.
3. Replace the `startsWith` checks with `.kind` checks.
4. Add a lint-time assertion that wire-format `match_key` strings round-trip through `Parse → String`.

**Size:** L. **Risk:** High — `match_key` is the on-disk + URL identity. Mistakes here silently rename rows; cover with a migration round-trip test before flipping any consumer.

## 4. `App.vue` (1925 lines) and `MatchesView.vue` (~2900 lines) are doing too much

**Where:** the two host SFCs. `App.vue` owns the router-shell, the lazy-view boundary, the selection state, the keyboard dispatcher, the focus management, the masthead state machine, the modal stack manager, the anchor toast, the file watcher, plus all the per-handler glue. `MatchesView.vue` owns the dossier, the dashboard widget grid, the narrow popover (~600 lines of template alone), the leaf-row list, the group/sort headers, the bulk-action bar — every concern of the Matches workspace.

**What breaks:** every new feature touches one or both files. Vue-tsc cache invalidation is slower than it should be (huge SFCs re-typecheck on small changes). New contributors can't find where to add code, and existing code becomes unreviewable in PRs. The "narrow popover" sub-tree alone is its own component shape — closing it inside `MatchesView` is what makes the narrow-vs-list selectors so brittle in e2e tests.

**Plan:**

1. Extract `<NarrowPopover>` from `MatchesView.vue`. Props: the `matchesNarrow` bundle + open/close. Template self-contained.
2. Extract `<BulkActionBar>` similarly.
3. Extract App.vue's keyboard handler into `useGlobalKeyboard()` — App.vue's `<script setup>` shrinks.
4. Each extraction is one PR, with a test-equivalence proof (existing e2e suite must still pass).
5. Stop here — the dossier itself is fine inside MatchesView.

**Size:** L (3-4 PRs of M each). **Risk:** Med — Vue's prop / event boundary needs careful typing; existing e2e selectors must keep matching.

## 6. No pagination on `GET /api/v1/matches`

**Where:** `api/openapi.yaml` — `GetMatchResults` returns the entire match corpus as a JSON array with no offset / limit / cursor. The Wails IPC variant has the same shape.

**What breaks:** memory + wire cost scales linearly with corpus size. A user with 2000 matches gets a ~6 MB JSON payload on every boot; with 10000 matches it's 30 MB. The frontend then has to keep the full array reactive. Server-side filtering (date range, hero, …) could shrink the wire payload, but the frontend filters in-memory only because the server doesn't accept filter params. The Prometheus collector reads the same untruncated list per scrape — at high scrape rates with a large corpus, the aggregator is wasted CPU.

**Plan:**

1. Add `?limit=&cursor=` to `GET /api/v1/matches`. Cursor is opaque (server-encoded `(parsed_at, id)` pair, base64'd) so clients don't depend on the schema.
2. Keep returning the unbounded list when no `limit` is set (back-compat). Document `limit` max as 1000.
3. Frontend: leave the dossier as a single fetch for now (the dossier needs the corpus to compute aggregates). Wire the Matches list view to paginate later, behind a flag.
4. Prometheus collector keeps the unbounded read — it's running locally, the JSON cost is moot.

**Size:** M. **Risk:** Med — pagination across views needs careful design (selection auto-close, prev/next bounds, narrowed-set semantics). Stage behind a feature flag if needed.

## 7. `POST /api/v1/parses` is a verb in a noun's clothing

**Where:** `api/openapi.yaml` — `POST /api/v1/parses` triggers a parse job synchronously and returns the result. There's no `parses` resource to GET (no `/api/v1/parses` list, no `/api/v1/parses/{id}` lookup). The path is named after a noun but functions like an RPC call.

**What breaks:** asynchronous progress reporting can't be added cleanly — the existing SSE channel (`pkg/app/sse.go`) lives separately and isn't discoverable from the OpenAPI spec. Spec consumers can't model a long-running job. The frontend can't poll for status (no resource to poll); it just waits for SSE events.

**Plan:**

1. Reshape as `POST /api/v1/parse-jobs` → 202 with `{id, status: 'running'}`. `GET /api/v1/parse-jobs/{id}` returns the same shape; `GET /api/v1/parse-jobs/{id}/events` is SSE.
2. Keep the existing synchronous `POST /api/v1/parses` for one release as a deprecated alias.
3. After clients migrate, delete the alias.

**Size:** L. **Risk:** Med — touches the parse pipeline's status reporting; needs SSE channel realignment.

## 8. `log.Fatal` at startup — REMAINING: Wails native dialog

**Where:** `pkg/app/app.go::Startup`. The five `log.Fatal` paths have been replaced with a captured `startupErr` field exposed via `StartupError()`. Server-mode wrapper (`pkg/cmd/server.go::RunServer`) now checks and exits cleanly with a "Recall server failed to start: <reason>" message instead of panic-style termination.

**What remains:** the Wails wrapper (`pkg/cmd/wails.go::RunWails`) doesn't yet surface the captured error to the user — failures still result in a flash-and-disappear window for desktop users. The frontend needs to poll `App.GetStartupError()` (new Wails-bound method TBD) on mount and render a modal if it returns non-empty.

**Plan:**

1. (Done) `App.startupErr` field + `captureFatal()` helper + `StartupError()` reader. Server-mode wrapper exits cleanly on non-nil.
2. Add `(a *App) GetStartupError() string` returning `a.startupErr.Error()` or "" — Wails-bound so the frontend can read it.
3. Wire `App.vue` to call `GetStartupError()` on mount; render a blocking modal when non-empty.

**Size:** S (remaining step). **Risk:** Low.

## 12. Bundle-size budgets bumped per-feature — observation tool now exists

**Where:** `scripts/check-bundle-size.sh` is still the budget gate; `scripts/audit-bundle.sh` (new) prints the top-N chunks by size. `make bundle-audit` runs it.

**What remains:** no actual lazy-load refactor yet — the audit shows `index-*.js` (84K), `MatchesView-*.js` (83K), `MatchDetailPanel-*.css` (30K) as the top offenders. Cracking either of the JS heavyweights into smaller chunks is the next move, but needs care: `App.lazy-views.test.ts` is the contract that enforces every lazy-load.

**Plan:**

1. (Done) `scripts/audit-bundle.sh` + `make bundle-audit`. Top-20 by size, totals.
2. Pick a heavyweight (likely `MatchesView` itself — already lazy, but ~82K of bytes). Extract its narrow popover into its own lazy chunk; measure the delta. This step couples with debt item 4 (SFC split).
3. Document the audit cadence in `docs/dev-reference.md`.

**Size:** S (remaining step). **Risk:** Low.
