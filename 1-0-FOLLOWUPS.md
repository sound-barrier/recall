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

- `[MED]` **Split MatchesView.vue + MatchCardExpanded.vue.** Pure
  behavior-preserving refactors. PR P1-H round-2 audit confirms
  both files are dominated by `<style scoped>` blocks (~1,615
  lines each) and the cohesive parts (narrow state, dossier
  refs, per-match handlers) don't decompose cleanly along the
  proposed extraction lines. Defer until the maintainer is
  blocked on a feature *because of* file size. **Effort:** L

### Frontend UX (first-run + error states)

- `[HIGH]` **Mid-parse network drop has no rollback UI.** Only
  affects server-mode SSE reconnection (Wails mode has no network
  drop scenario). PR #5 deferred with rationale: not a 1.0 desktop
  blocker; revisit when the headless server gets first-class UX
  attention. **File:** `App.vue:614` + `ParseProgressPanel.vue`.
  **Effort:** M

### Design system + visual polish

- `[MED]` **`--accent` split** into `--interactive-accent` vs
  identity-accent. Needs a design pass to pick a second hue —
  the rest is mechanical. PR P1-G round-2 audit recorded the
  deferral; revisit when a design spec lands. **Effort:** M

## P2 — Nice-to-have

### Code-quality cleanup

- `[LOW]` **Adopt `log/slog`** for production debugging (parse
  start/end, DB schema apply, API handler entry/exit). **File:**
  all. **Effort:** L

### Features (post-1.0)

- `[LOW]` **In-app auto-updater.** Wails v2 supports it; today
  the user clicks "Open release page." Defer to 1.1. **Effort:** L
