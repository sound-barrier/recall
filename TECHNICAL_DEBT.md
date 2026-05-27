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
