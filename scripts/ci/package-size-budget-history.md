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
| 2026-08-16 | package-size-discipline | `frontend/src/composables/matches` | 20 (waived 51) → 20 | Waiver PAID. The 51 modules moved into subfolders mirroring `components/matches/`'s existing folder names — narrow (12), list (13), table (6), dossier (7), detail (4), manual (2), pivot (1), timeline (1), trends (2) — leaving `useMatchActions` + `useExportBundle` at the root because they serve the whole tab rather than one band of it. `useCardFocus` went to `composables/shared/`: its only importer is `stores/ui.ts` and it serves MatchesView and UnknownMapsView alike. Pure move, no renames. |
| 2026-08-16 | package-size-discipline | `frontend/src/composables/matches/list` | — → 13 | New registration, one over the default 12. The count is inherited from the split above, not grown: this is the set that backs `components/matches/list`, and reaching 12 by evicting one module would have broken the mirror the rule asks for. |
| 2026-08-16 | package-size-discipline | `frontend/src/match` | 20 (waived 45) → 20 | Waiver PAID. The 45 pure-helper modules split into the sub-domain folders their filename prefixes already named — `elo/`, `coach/`, `pivot/`, `dossier/`, `compare/`, `trends/`, `table/`, `export/` — leaving 8 at the root: the cross-domain ids with the biggest import fan-outs (`match-time-helpers` reaches 14 directories, `match-helpers` 8), which should never move again. Sub-domain folders rather than a top-level `src/elo/`, because this tree's top level is a layer taxonomy and one documented home for pure helpers is the rule people actually apply. Budget held at 20 rather than ratcheted to 8: it is the declared frontend ceiling, and a helper landing back at this root should be a deliberate choice, not the default. |
| 2026-08-16 | package-size-discipline | `frontend/src/match/elo` | — → 13 | New registration, one over the default 12. The count is inherited from the split above, not grown: these thirteen modules were one coherent `elo-*` family before the regroup, and splitting them further would separate the decay-aware simulator from the closed forms that must agree with it — the invariant the Elo coherence campaign exists to hold. The four `components/elo/*.ts` view helpers deliberately did NOT move here; `elo-chart-options.ts` imports a type from `components/matches/trends/`, so relocating it would invert the layering. |
