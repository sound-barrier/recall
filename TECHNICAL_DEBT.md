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

**This may not be worth pursuing — the substantive families are genuinely
shared** (findings from a four-family audit; verify before investing more):

- Every substantial family checked is multi-component, so the per-SFC scoped
  premise mostly fails: `.slot-*` → MatchCardExpanded + MatchSources +
  UnknownMapsView; `.source-*` → those + SupportedSourcesRow; `.system-alert-*` →
  SystemAlertBanner + MatchCardExpanded; `.probe-*` → SettingsEngine +
  SettingsFolders + SettingsView. Per the rule ("if more than one component
  references it, keep it in app.css") they all stay.
- The only families that came back theme-free AND plausibly single-component are
  tiny App/AppMasthead chrome (`.scoreboard`, `.skip-link`, `.atmos`,
  `.grid-lines`, `.masthead-left/right` — 1–3 rules each); extracting them yields
  almost nothing, and App.vue intentionally has no `<style>` block.
- Families with `[data-theme="day"]` overrides must keep those in app.css under a
  parent id regardless — the scoped-style `:global` miscompile gotcha (frontend
  CLAUDE.md "Styles").

Net: the large app.css is a real navigability cost, but the "extract to scoped"
fix is largely **not applicable** because the selectors are genuinely
cross-cutting. Before doing more here, re-audit the remaining families; if they're
all multi-component too, the better move is to *organize* app.css (section
headers / split into a few topical `@import`ed files) rather than chase scoped
blocks. Then this section becomes "split app.css into topical files", not the
method below.

**Method — one selector-family per commit:**

1. Confirm exactly one SFC references the family (`grep -rln '<family>' src/components`).
2. Move the base rules into that SFC's `<style scoped>`; rewrite any `[data-theme]`
   override to stay in app.css under a parent id.
3. `cd frontend && npm run build` then `grep -c '^\[data-theme=light\]{' dist/assets/*.css`
   must stay **0**; run the a11y/axe e2e specs.

**Candidate families to audit** (verify single-component first, skip token-level +
multi-component ones): `.system-*` (SystemAlertBanner), `.brandmark-*` / `.ver-*` /
`.nav-tab-*` (AppMasthead), `.probe-*` (Settings → Engine).

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
