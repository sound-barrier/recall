# Package & directory size budget history

The per-directory file budgets in `scripts/ci/package-size-budgets.txt` get
bumped when a grouping legitimately grows, and ratcheted down when a split
lands. This is the running record of why each number moved, so a future
maintainer doesn't have to `git blame` a comment block.

Append a row when you change a number. Date in ISO 8601; **PR** is whichever PR
landed the change; **From → To** is the budget column (mention the waiver in the
rationale if you touched it). One line, no soft-pedaling.

Numbers that go **down** get a row too — a ratchet after a split is the most
valuable row in this table, because it is the only evidence the debt was
actually paid rather than re-waived.

The two legitimate reasons for an upward bump: the new file is the same
responsibility spelled one concern wider, or the directory's responsibility
genuinely grew and splitting would separate things that change together. "The
gate was in the way" is not one of them.

| Date | PR | Directory | From → To | Rationale |
|---|---|---|---|---|
| 2026-08-16 | package-size-discipline | *(all)* | — → initial | Gate introduced. Budgets set to each directory's count on this date, zero headroom, except the six groupings with a split owed in this campaign (`frontend/tests/e2e`, `composables/matches`, `src/match`, `composables/shared`, `components/matches/list`, `components/shared`), which carry the target in the budget column and today's count as a temporary waiver so the file records intent instead of ratifying the sprawl. Frontend target = 20, the low end of the "~20–25" ceiling both CLAUDE.md files documented and nothing ever asserted. `pkg/app` registered at its current 54 **provisionally** — the split that pays it is designed but unmeasured, and guessing a target would be worse than recording the real one; the closing commit of this campaign replaces it. `frontend/src/client` exempt (generated). `dashboard/widgets` registered at 40 with no waiver: it is the `pkg/db` case on the frontend and the split is deliberately deferred. |
