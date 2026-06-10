# Recall 1.0 follow-ups

Items deferred from `1-0-RELEASE-PLAN.md` when 1.0 cut. Inherits the
plan's severity / effort tags; rationale for each deferral is in the
matching plan box (kept around as a historical record — `git log
1-0-RELEASE-PLAN.md` traces every audit decision).

Append a one-line PR pointer to the right of an item when it lands so
the file shrinks naturally. Delete an item entirely once it ships —
this file is **not** a striking-out log.

> **Why these specifically.** Each was either (a) a P1/P2 polish item
> the 10-PR plan explicitly bundled out, (b) a refactor whose risk
> outweighed its pre-1.0 value (see PR #8's audit for the precedent),
> or (c) a feature scoped as "post-1.0" from day one. None is a
> compliance / contract / first-impression blocker — that scope all
> landed pre-1.0.

## P1 — Should fix early-1.x

### Code quality

- `[MED]` **`SSEHub` race during teardown.** Parse loop holds
  `parseMu` while broadcasting events; if `SSEHub` gets torn down
  mid-broadcast (profile switch, app shutdown) there's a window.
  Encapsulate parse lifecycle behind a `ParseState` type or guard
  the broadcast site. **File:** `pkg/app/app.go:75-90` +
  `pkg/app/parse.go`. **Effort:** M
- `[MED]` **Split MatchesView.vue + MatchCardExpanded.vue.** Pure
  behavior-preserving refactors. Defer until the maintainer is
  blocked on a feature *because of* a file's size. Mechanical
  extraction order documented in PR #8. **Effort:** L

### Frontend UX (first-run + error states)

- `[HIGH]` **Mid-parse network drop has no rollback UI.** Only
  affects server-mode SSE reconnection (Wails mode has no network
  drop scenario). PR #5 deferred with rationale: not a 1.0 desktop
  blocker; revisit when the headless server gets first-class UX
  attention. **File:** `App.vue:614` + `ParseProgressPanel.vue`.
  **Effort:** M

### Design system + visual polish

- `[MED]` **`--accent` split** into `--interactive-accent` vs
  identity-accent. Touches every theme + every chip / button /
  pill. Disproportionate blast radius for marginal user value.
  **Effort:** M
- `[MED]` **Empty-state visual consistency container.** Large
  refactor across every view; empty states are infrequently
  rendered. **Effort:** M
- `[MED]` **Spacing rhythm tokens** in the narrow panel — `--space-X`
  tokens require a project-wide spacing audit. **Effort:** S

## P2 — Nice-to-have

### CI / tooling

- `[LOW]` **Pre-push smoke subset gaps** — expand the filter list
  once historical flakes have a pre-push gate. **File:**
  `lefthook.yml` + `scripts/check-playwright-smoke.sh`. **Effort:** S

### Code-quality cleanup

- `[LOW]` **Magic numbers** — pull the remaining outliers into
  named consts: timezone offset in `text.go`, OCR upscale (`2x`)
  in `imageutil.go`, Levenshtein threshold (`3`) in `maps.go`.
  **File:** `pkg/parser/`. **Effort:** S
- `[LOW]` **Public-API doc comments** missing on
  `pkg/parser/classify.go` and `pkg/parser/golden.go`. Add
  package-level + per-function comments where exported.
  **Effort:** S
- `[LOW]` **Adopt `log/slog`** for production debugging (parse
  start/end, DB schema apply, API handler entry/exit). **File:**
  all. **Effort:** L

### Property-based testing

- `[LOW]` **Property-based / fuzz tests** on parser entry points
  (`parser.Parse*`) and URL handlers (`/_screenshot/<filename>`).
  Use Go's native `testing.F`. **File:** `pkg/parser/`. **Effort:** M

### Doc conventions

- `[LOW]` **Document the test-only-API convention** in
  `CONTRIBUTING.md` (`app.NewWithStore`, `parser.ToGolden`,
  `pkg/db/dbtest`, etc.). **Effort:** S
- `[LOW]` **Document the "no telemetry" choice** explicitly in
  `SECURITY.md`. **Effort:** S

### Features (post-1.0)

- `[LOW]` **In-app auto-updater.** Wails v2 supports it; today
  the user clicks "Open release page." Defer to 1.1. **Effort:** L
