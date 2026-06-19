# Technical debt

Delete a section when it's paid — git history is the audit trail, not a
strikethrough graveyard. No `~~item~~`, no `✅ DONE` subsections: when an item is
resolved, remove it. Section numbers are stable (gaps are fine; never renumber).
Keep each entry specific enough to act on without re-deriving the context.

## 1. `frontend/src/styles/app.css` — extract single-component selectors to scoped blocks

`app.css` is ~2950 lines of globally-scoped CSS. Component-specific selector
families should move into the owning SFC's `<style scoped>` so the rule only
matches that component, leaving `app.css` for genuinely cross-cutting tokens +
families (`.btn` / `.badge` / `.section-*` / `.setting-*`) and **all** theme
overrides.

**Why this is a careful audit, not a quick sweep** (findings from the first pass):

- The "obvious" candidates the frontend CLAUDE.md names are NOT single-component:
  `.slot-chip` / `.slot-dot` are used by `MatchCardExpanded` + `MatchSources` +
  `UnknownMapsView`; the `.source-*` family by those plus `SupportedSourcesRow`.
  Per the rule ("if more than one component references it, keep it in app.css")
  they stay put.
- Most families carry `[data-theme="day"]` overrides, which MUST stay in app.css
  under a parent id — the scoped-style `:global` miscompile gotcha documented in
  the frontend CLAUDE.md "Styles" section. So a single-component family that has
  theme rules splits: base → the SFC's scoped block; theme → app.css rewritten
  under `[data-theme="day"] #panel-x .y`.

**Method — one selector-family per commit:**

1. Confirm exactly one SFC references the family (`grep -rln '<family>' src/components`).
2. Move the base rules into that SFC's `<style scoped>`; rewrite any `[data-theme]`
   override to stay in app.css under a parent id.
3. `cd frontend && npm run build` then `grep -c '^\[data-theme=light\]{' dist/assets/*.css`
   must stay **0**; run the a11y/axe e2e specs.

**Candidate families to audit** (verify single-component first, skip token-level +
multi-component ones): `.system-*` (SystemAlertBanner), `.brandmark-*` / `.ver-*` /
`.nav-tab-*` (AppMasthead), `.probe-*` (Settings → Engine).

## 2. `mountApp` `@/api` mock isolation — multi-fork flake

`App.test.ts` intermittently fails a single assertion (seen: "switching tabs
swaps the visible view panel") only under multi-fork Vitest; it passes in
isolation and under `--no-file-parallelism`. Root cause: the Pinia stores
statically `import` value functions from `@/api`, and a hoisted
`vi.mock('@/api')` in another test file can leak across files under low fork
counts, so App's store binds the wrong mock. `mountApp` already mitigates with
`vi.doUnmock('@/api')` + `vi.resetModules()` + a `mockedApi()` capture — the
correct Vitest pattern for a per-test-configurable mock of a statically-imported
module. This is **not** "fixable" by ripping the triad out; a dependency-injected
api seam threaded through all four stores would be disproportionate. **Mitigation
today:** re-run the job, or run single-fork. Only pay this down (add a store-level
api seam) if the flake becomes frequent in CI.

## 3. Consciously accepted — do NOT "fix" these without a new reason

Recorded so a future pass doesn't burn effort churning them (each was reviewed
and deliberately left):

- **`useMatchesDossierQueries.ts` (~696 lines) and `useMatchesNarrow.ts` (~539)**
  exceed the 500-line soft cap, but the bulk is a single cohesive dense function
  each — exactly what the file-size rule exempts. The narrow file's shared types +
  state factory were already split out (`matchesNarrow.types` / `.state`);
  fragmenting the remaining filter/query math would hurt cohesion for a number.
- **Report-only cyclomatic-complexity warnings** (`load()` 14, `parseSearchQuery`
  18, `valueLabel` 11): the complexity lefthook step is REPORT-ONLY for a reason —
  these are branchy by nature (an `allSettled` boot coordinator, a search-query
  parser). Refactor only if a real readability/bug problem surfaces.
- **The remaining `as unknown as` casts** (`mountWidget` partial-dossier fixture +
  the `mount()` overload cast, the ECharts series union) are legitimate
  type-boundary casts. The one genuine type-lie (`enterEditMode` cast from
  KeyboardEvent to MouseEvent) was fixed.
- **External CI flakes** — the schemathesis random-seed failures on the PUT
  settings endpoints and the WebKit `match-detail-panel` timeout are
  non-deterministic and not fixable in code; re-run the job.
