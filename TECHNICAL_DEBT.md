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

## 20. Day-theme color-contrast pass — bring day theme up to AA across matches view

**Where:** `frontend/src/styles/app.css` (the `[data-theme="day"]`
palette around lines 130–174) plus every consumer of
`--accent-text` and `--primary-text-on-accent` in day. Loudest
offenders surfaced by axe so far: `.seg-btn.picked`,
`.leaves-eyebrow`, `.skip-link` and most modal-button
text-on-accent fills, every `.hero-name` / `.length-mark` /
`.source-type-summary` rule. Day's `--accent-text` is `#b8650a`
on `#f5f3ed` (~3.85:1), `--primary-text-on-accent` is `#fff8ef`
on `#fa9c1b` (~1.92:1) — both sub-AA.

**What breaks:** running `frontend/tests/e2e/a11y.spec.ts` with
the day theme pinned currently raises serious `color-contrast`
violations. PR C added a matches-view × theme axe loop covering
dark / night / high-contrast and explicitly excluded day with a
comment pointing at this entry. Day-theme users (and anyone with
matching OS preferences) see small uppercase callouts and
text-on-accent fills below the WCAG 2 AA 4.5:1 threshold for
small bold text.

**Plan:**

1. Darken `--primary-text-on-accent` for day from `#fff8ef` →
   `#1a0a00` (or another dark brown that clears AA on
   `--accent` `#fa9c1b`). Verify the skip-link, the picked
   seg-btn, every modal-button "Save"/"Done" fill, and the
   active-tab underline label.
2. Darken `--accent-text` for day to a value that clears 4.5:1
   on `--surface` (`#f5f3ed`) — likely `#9e4d00` or thereabouts.
   Audit every `.hero-name`, `.length-mark`,
   `.source-type-summary`, `.leaves-eyebrow`, the chip border
   text, and the dossier section eyebrows.
3. Drop the `'day'` exclusion from the `THEMES` array in
   `frontend/tests/e2e/a11y.spec.ts` and the corresponding
   comment; rerun `make test-e2e -g "day theme"` and watch the
   violation list trend to zero.
4. Manual visual eyeball — the rust-orange becomes meaningfully
   darker in day theme. Sanity-check brand identity against the
   in-game OW post-match summary screen (the cream-on-orange
   that day theme references).

**Size:** M.
**Risk:** Low for steps 1–3 (theme-scoped CSS + test config);
Med for step 4 (subjective brand-feel review against the OW
identity day theme references).
