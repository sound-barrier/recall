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

## 6. Pagination on `GET /api/v1/matches` — REMAINING: frontend consumer

**Where:** `pkg/cmd/server_matches.go` adds `?limit=` (1–1000) + `?cursor=` to `GET /api/v1/matches`. OpenAPI spec updated; `api.gen.d.ts` regen'd. 5 unit tests pin the contract (back-compat unbounded, limit-only, cursor-paging, clamp, invalid-limit-disables).

**What remains:** the frontend still does the full-corpus fetch on boot. The dossier needs the whole corpus to compute aggregates — that's the limiting factor. A future consumer (the Matches list view, infinite-scroll behind a flag) is the natural place to wire pagination in. Prometheus collector stays unbounded (local read, JSON cost moot).

**Plan:**

1. (Done) Server-side `?limit=&cursor=`. Back-compat (no params → full corpus).
2. Frontend: leave bulk fetch as-is for the dossier. When the dossier moves to server-side aggregation (probably alongside the Analysis tab), the bulk fetch becomes opt-in.

**Size:** S (remaining). **Risk:** Low.

## 7. `POST /api/v1/parses` is a verb in a noun's clothing — DEFERRED (needs job-lifecycle model)

**Where:** unchanged.

**Why deferred:** reshaping to `parse-jobs` is contingent on whether parsing actually wants an async-job lifecycle (status polling, cancellation, multi-job queuing). The current synchronous model works for the desktop use case (one user, one folder, one click). Adding a job lifecycle adds operational complexity (queue management, persistence across restarts) that's only worth paying if a real consumer (e.g. a planned server-mode multi-tenant deployment) needs it.

**Plan:**

1. Decide whether the async-job lifecycle is wanted. The Analysis tab + the future server-mode use cases inform this.
2. If yes: introduce `POST /api/v1/parse-jobs` → 202 with `{id, status}`, keep current synchronous route as a deprecated alias for one release.
3. If no: rename the deprecation marker on this debt item to "intentional design" and remove from the list.

**Size:** L if executed. **Risk:** Med.

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
