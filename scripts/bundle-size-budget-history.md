# Bundle-size budget history

The four byte budgets in `scripts/check-bundle-size.sh` get bumped
when real features need the room. This is the running record of why
each bump happened, so a future maintainer doesn't have to
`git blame` a single overgrown comment.

Append a row to the table when you bump a budget. Date in ISO 8601;
the **PR** column is whichever PR landed the bump; the **JS** /
**CSS** columns are the **total** budgets after the change (in
bytes — same units the script asserts against). One-line rationale,
no soft-pedalling. Numbers that go down get a row too.

| Date | PR | Init JS | Init CSS | Total JS | Total CSS | Rationale |
|---|---|---|---|---|---|---|
| 2026-06-08 | technical-debt-sweep | 156000 | 60000 | 422000 | 242000 | match-helpers.ts split into 5 topic files. Total JS dropped slightly, but Vite's chunking heuristic hoisted the smaller new modules into the initial chunk, lifting initial JS ~10 KB. Tradeoff is intentional — readability of the topic split outweighs the chunk-boundary shift; total stays under cap. |
| 2026-06-08 | #227 | 146000 | 60000 | 422000 | 242000 | Parser tightening (length-gated fuzzy Pass-2) + the Reference-data-gaps UI on the Unknown tab landed alongside the screenshot-source picker. Combined coverage. |
| 2026-06-08 | #226 | 146000 | 60000 | 422000 | 242000 | Windows screenshot source picker (4-card grid) — net JS +14 KB across `ScreenshotSourcePicker.vue` + first-run wiring. CSS bumped to absorb the picker grid styles. |
| 2026-06-05 | #224 | 146000 | 60000 | 408000 | 230000 | Parser fuzzy fix + `hero_raw`/`map_raw` schema + Unknown-hero leaf chip + detail-panel gap banner. |
| pre-2026-06 | — | varies | varies | varies | varies | Prior bumps stacked one-line rationales onto the comment in `scripts/check-bundle-size.sh`. Anyone curious can `git log -p scripts/check-bundle-size.sh` to walk the older bumps; representative ones include `19febaf chore(bundle): bump JS+CSS budgets for the PR 6 sort+group dropdown` and the various PR D/E/F dashboard waves. |

## When to bump

- **A real feature needs the room.** The 2026-06-08 audit reset the
  floor lower than the previous "just bump it" drift; future bumps
  should be specific and justified.
- **Substantial modal surfaces should ride
  `defineAsyncComponent(() => import(...))`** so they land in their
  own chunk and stay out of the initial budget. The detail panel,
  screenshot lightbox, and cheatsheet are the pattern to mirror.
  `App.lazy-views.test.ts` is the regression guard that fails if a
  static import sneaks back in.
- **Don't bump to silence noise.** If a non-feature PR is pushing
  the budget, that's a bug — investigate before lifting the cap.

## Where this is checked

- `scripts/check-bundle-size.sh` — the assertion. Run by CI's
  "Enforce bundle-size budget" step + lefthook's pre-push.
- `.github/workflows/ci.yml` — the CI invocation.
- `lefthook.yml` — the pre-push invocation (uses the script's
  defaults, no env overrides).
