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

## 1. `pkg/cmd/server.go::NewMux` is 95-complexity

**Where:** `pkg/cmd/server.go:178` — `NewMux` registers every HTTP route inline (matches CRUD, annotations, reviews, profiles, settings, parses, screenshots, …). gocyclo reports **95**; the next-highest function in the codebase is 43, and McCabe's guidance is 10. The file is 985 lines and `NewMux` accounts for ~700 of them.

**What breaks:** every new route has to land inside one giant function, so route additions look like 100-line diffs and become un-reviewable. Branch coverage is hard to keep honest because dead-branch dropping would require splitting the function — but splitting requires choosing seams, which nobody has. New contributors touching routing have nowhere safe to start, and a route-aware test that mounts a partial mux can't exist because there are no partials.

**Plan:**

1. Identify natural sub-muxes — matches/, profiles/, settings/, parses/, screenshots/. Each gets its own `registerMatchRoutes(mux, app)`, `registerProfileRoutes(...)`, etc.
2. Move handlers + helpers per family into `server_matches.go`, `server_profiles.go`, … with the file naming the existing convention (`server_review_test.go` already uses this shape — match it).
3. `NewMux` becomes ~30 lines: instantiate router, fan out to each registrar.
4. No behaviour change. Existing schemathesis + e2e tests are the contract.

**Size:** L. **Risk:** Med — route table is the public API; getting the mount path wrong = silent 404.

## 2. `useMatchFilters`'s main predicate is 85-complexity

**Where:** `frontend/src/composables/useMatchFilters.ts:142` — one anonymous arrow inside `filteredSorted` chains every filter dimension (search, date, map, hero, role, result, tags, leaver, min-play, includeUnknown, hidden, …) into a single `return base.filter(r => { … })`. ESLint reports complexity **85**. `useMatchesNarrow.ts:267` runs the same shape at complexity **42**. The total filter math is duplicated across both composables: Matches uses `useMatchesNarrow`, the old archive surface still uses `useMatchFilters`.

**What breaks:** adding a new filter dimension (the "reviewed by" + "since-anchor" pair shipped recently) means editing two giant predicates that are easy to get out of sync. The composables diverge silently — the recent reviewed-by add only landed in `useMatchesNarrow`. Branch coverage in the surviving 85-line predicate isn't honest; tests cover the WHOLE function, not the individual gates.

**Plan:**

1. Extract per-dimension predicates into named helpers: `matchesSearch(r, query)`, `matchesDateRange(r, from, to)`, etc. Each ≤ 15 lines, individually unit-testable.
2. The composables become `base.filter(r => predicates.every(p => p(r, state)))`.
3. Delete `useMatchFilters` if `useMatchesNarrow` covers every consumer (the archive drawer was the last hold-out — check after extracting).
4. Keep the existing integration tests as the contract; per-predicate unit tests are an additive write.

**Size:** M. **Risk:** Low — predicate-by-predicate refactor is straightforward; tests already pin the aggregate behaviour.

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

## 5. No `GET /api/v1/matches/{matchKey}` — single-match reads require fetching the full list

**Where:** `api/openapi.yaml` — `/api/v1/matches/{matchKey}` declares only `DELETE` (and `PUT` for visibility/annotation/review sub-resources). There's no path to fetch one match by key.

**What breaks:** the frontend's "open detail panel" path re-uses the bulk `GetMatchResults` payload + a local lookup. A user with 5000 matches transfers 5000 records every time they click any single row. The Prometheus collector has the same shape — scrapes pull the full corpus, then filter. A future external integration ("Grafana single-match annotation overlay") can't reach a single match without fetching all of them.

**Plan:**

1. Add `GET /api/v1/matches/{matchKey}` returning a single `MatchRecord`. 404 on not found. Schema reuses the existing component.
2. Schemathesis covers the contract on next CI run.
3. Frontend: add `GetMatch(matchKey)` to `api.ts`; route the detail-panel open through it. Bulk list reads stay where they are (the dossier still needs all records).

**Size:** S. **Risk:** Low — new endpoint, no schema changes to existing endpoints.

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

## 8. `log.Fatal` at startup makes the desktop app crash silently

**Where:** `pkg/app/app.go:138`, `:149`, `:153`, `:205`, `:210` — five `log.Fatal` calls in the Wails startup path. Fail conditions: can't init profiles, can't create `--profile` target, can't activate it, can't create the DB dir, can't init the DB.

**What breaks:** a misconfigured Recall install (corrupt profile dir, perms issue, full disk) exits with a log line nobody sees — the Wails app window flashes and closes. The user has no visible error. The server-mode binary at least prints to stderr, but the Wails build window swallows it. There's no recovery path.

**Plan:**

1. Replace each `log.Fatal` with a surfaced error: return from `Startup` (so the Wails wrapper can show a modal) or write to a known-location crash log + show a Tk-style native error dialog.
2. Add a `pkg/app/startup_error.go` with a small `RecoverableStartupError` type carrying user-facing copy + the underlying error.
3. Keep `log.Fatal` only for genuinely unrecoverable cases — none of the current five qualify.

**Size:** M. **Risk:** Med — startup paths are hard to test end-to-end; cover with table-driven Startup tests that inject failures.

## 9. `panic()` on embedded-YAML parse failure prevents boot if the bundled data is malformed

**Where:** `pkg/parser/owdata.go:105` (`heroes.yaml`), `:122` (`maps.yaml`), `:139` (`hero_stats.yaml`) — three `panic()` calls on YAML parse errors. The data is `//go:embed`'d at build time, so in practice a bad YAML means a bad build.

**What breaks:** a malformed YAML escapes CI (lint catches syntax but not schema) and the binary panics on first import. Worse, the panic happens during init when the user has no error reporting yet. For a desktop app this is "window opens, then disappears" with no user-facing message.

**Plan:**

1. Replace `panic` with a build-time validation test that exercises the parse against every shipped YAML. A bad YAML now fails CI, not the binary.
2. At runtime, on parse failure: log the error + fall back to an empty registry (every hero is "unknown role", every map is "unknown type"). The app keeps booting; the Matches view shows unknowns instead of crashing.
3. Surface the registry-empty state in the UI as a banner: "OW data failed to load — heroes/maps will show as unknown until the next update."

**Size:** S. **Risk:** Low — the build-time test catches the case the panic was trying to catch.

## 10. No down-migration round-trip test

**Where:** `pkg/db/migrate.go` + `pkg/db/migrations/*.{up,down}.sql`. An existing test asserts every `.up.sql` has a paired `.down.sql`, but no test runs the down then re-applies the up to verify the down actually reverses the up.

**What breaks:** a future migration ships a `.down.sql` that doesn't reverse the `.up.sql`. Production rollback is exercised for the first time in production, where it fails. We don't have a documented rollback procedure today, so the down files are effectively documentation; making them runnable + tested is the cheapest insurance.

**Plan:**

1. Add `TestMigrationsRoundTrip` in `pkg/db/migrate_test.go` that, for each `(N, up, down)`: applies all migrations 0..N, runs `down(N)`, asserts `schema_version` matches N-1, runs `up(N)` again, asserts the schema matches.
2. Schema-match assertion uses `PRAGMA table_info` per table.
3. New migration PRs now have a forcing function for correct down files.

**Size:** S. **Risk:** Low.

## 11. No request correlation in server logs

**Where:** `pkg/cmd/server.go` — handler logs (`log.Printf`) are timestamp-only. Multi-step ingest flows (POST `/parses` → parser dispatch → DB upserts → SSE notify) can't be traced through the log without manual time-window grepping.

**What breaks:** debugging a user's failed parse from a downloaded `recall.log` means scrolling through lines that don't co-relate. With concurrent screenshots being parsed, lines from different ingests interleave.

**Plan:**

1. Add a middleware that injects a request ID into context + every log line. Use the existing `X-Request-ID` header if present, else generate.
2. `pkg/app/parse.go`'s dispatcher receives the request ID via context + threads it into the per-screenshot log lines.
3. Optional: include the request ID in error responses so a user reporting a bug can paste it.

**Size:** S. **Risk:** Low.

## 12. Bundle-size budgets are bumped per-feature, never paid down

**Where:** `scripts/check-bundle-size.sh`. The JS budget has bumped 362K → 365K → 368K → 372K in the last four PRs. CSS has gone 205K → 208K → 211K. There's no pass that asks "what's actually big?" — every feature gets the bump it needs.

**What breaks:** initial JS is 84K (well under the 146K budget), so users aren't feeling it yet. But the trend is monotonic: total JS doubled in the last six months. Sooner or later the budget bumps will be denied at code review and the offending feature has to refactor under time pressure.

**Plan:**

1. One-shot audit: `npx vite-bundle-visualizer` and identify the top 5 chunks. Probably the dashboard widget registry, the narrow popover, and the dossier. Each could lazy-load behind their entry point.
2. Pick one of the three, lazy-load it, measure the win.
3. Document the audit in `docs/dev-reference.md` so the next bump prompts a re-audit, not another bump.

**Size:** M. **Risk:** Low — lazy-loading is well-trod in this codebase already (`App.lazy-views.test.ts` enforces the pattern).

## 13. `MatchesNarrowState` borrows a ref from `useMatchAnchor` — shared mutable across a composable seam

**Where:** `frontend/src/composables/useMatchesNarrow.ts` — `MatchesNarrowState.anchorKey` is doc'd as "owned by `useMatchAnchor`, borrowed here." App.vue threads the singleton's ref into `createMatchesNarrowState({ anchorKey })`. The narrow filter reads the ref + the persisted-anchor composable owns it.

**What breaks:** the contract is doc-only — there's no compile-time check that the borrowed ref is in fact `useMatchAnchor`'s. A future contributor sees `Ref<string>` in the State type and threads their own session-scoped ref through, breaking persistence silently. The reset-narrow path explicitly DOESN'T clear `anchorKey` because of the ownership boundary — a pattern that's wrong to read in isolation.

**Plan:**

1. Replace `anchorKey: Ref<string>` in `MatchesNarrowState` with `anchorSource: { read(): string }`. The narrow composable depends on the smaller interface.
2. `useMatchAnchor()` exposes `.anchorSource` as a getter; tests can satisfy it with a literal `{ read: () => 'm1' }`.
3. The ownership boundary is now type-checked: nobody can write to `anchorSource`, only `useMatchAnchor` mutates the underlying ref.

**Size:** S. **Risk:** Low — the contract change is internal to the composable.

## 14. Frontend complexity has no trend tracking — hot files grow silently

**Where:** the `complexity` job + `pre-push.complexity` lefthook hook are NEW (added by this PR). They emit findings but don't track history. We know `useMatchFilters` is at 85 today; we don't have a baseline to alarm on "this PR doubled the complexity of `parseSearchQuery`."

**What breaks:** a PR that nudges an already-fat function from 18 → 24 is invisible in review. The hot list trends upward; no individual PR is bad enough to flag.

**Plan:**

1. After a release cycle of the new complexity job, capture a baseline (top-20 functions by score) into a checked-in `docs/baselines/complexity-baseline.txt`.
2. Add a CI step that diffs the current run against the baseline + adds a PR comment when a function climbs by ≥ 5 OR enters the top-20.
3. Still report-only; the bar is "we know it happened", not "block the merge."

**Size:** M. **Risk:** Low — adding observability, not enforcement.
