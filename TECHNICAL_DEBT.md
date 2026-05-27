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

## 5. Residual SFC splits — finish the big-file extractions

**What.** Three first-pass extractions landed (`MinPlayInput.vue` +
`LeaverSegmented.vue` out of `FilterRail.vue`; `MatchCardDanger.vue`
out of `MatchCard.vue`; `SettingsCalendar.vue` out of
`SettingsView.vue`) — proves the seam pattern. The bigger remaining
extractions are:

| File | Current | Target | Children still to extract |
|---|---|---|---|
| `MatchCard.vue` | 1714 | ~900 | `MatchCardHeader.vue` (collapsed view) + `MatchCardExpanded.vue` (annotation + notes + stats + sources blocks) |
| `SettingsView.vue` | 1666 | ~250 | `SettingsFolders.vue`, `SettingsEngine.vue`, `SettingsAppearance.vue`, `SettingsBackupRestore.vue`, `SettingsAdvanced.vue` |
| `FilterRail.vue` | 951 | ~700 | Optional: combined `<TallyToggle>` for the Hidden + Undated buttons |

**Why this matters.** Each remaining extraction is independent —
none blocks any other. The biggest payoff is the MatchCard
Header/Expanded split (~−800 lines off MatchCard's footprint) since
that file is the most-edited frontend SFC. SettingsView's five
remaining panels are mechanically the easiest (each panel is already
a self-contained `<section>` in the template) but the total payoff
is the largest reduction.

**Plan.** One extraction per PR, smallest first to keep review
manageable. Each must:

1. Move the matching `<section>` (Settings) or template block
   (MatchCard) into a new SFC under `frontend/src/components/`.
2. Move the corresponding scoped-style block too — scoped CSS lives
   with the SFC that owns the template.
3. Wire props/emits through; only the wiring that survives the cut
   should remain on the parent.
4. `make typecheck` + `npx vitest run` + `npx eslint` + `npx
   stylelint` clean before commit.

**Size.** **M** per remaining extraction; **L** if all six land in
one go (not recommended).
