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

## 15. Cancel-in-flight parse — additive endpoint + Parse-tab Stop button

**Where:** `pkg/app/parse.go` (the OCR loop), `pkg/cmd/server_pipeline.go` (new DELETE route), `frontend/src/components/IngestView.vue` (Stop button + cancelling-state UI), `api/openapi.yaml`.

**What breaks:** A long-running parse (hundreds of screenshots, slow disk, large images) has no user-visible abort today. Users either wait it out or kill the process, losing any in-flight aggregations that haven't been flushed. Surfaced as a fresh item when item #7 closed as intentional design — `POST /api/v1/parses` stays as the noun-shaped invocation, cancellation rides on an additive DELETE so the URL shape doesn't need to move.

**Plan:**

1. `*App` gets a cancellation seam — either a `parseCancelled atomic.Bool` field checked between screenshots, or a `context.CancelFunc` stashed when the parse starts and called by the cancel handler. The OCR loop checks it after each per-file flush and returns early; in-flight writes flush before the return so the partial corpus isn't lost.
2. `DELETE /api/v1/parses/active` → 202 Accepted. Wails-binds to `(a *App) CancelParse() error`. 409 Conflict when no parse is in flight.
3. Final SSE event `parse-cancelled` (in addition to `parse-complete`) so the frontend can flip the Stop button back to Run without polling.
4. Frontend: Stop button on the Parse tab visible whenever `parseBusy === true`. Click fires `CancelParse()`, sets a local "cancelling…" state until the SSE confirms; never blocks the UI thread.

**Size:** M. **Risk:** Low — additive endpoint, no contract change to the existing `POST /api/v1/parses`.
