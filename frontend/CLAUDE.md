# Frontend (`frontend/src/App.vue`)

This file is auto-loaded by Claude Code when working in `frontend/`.
The root `CLAUDE.md` carries the cross-cutting project context —
including the **REST API design** rules (verbs, status codes,
response shapes, the 3-step add-an-endpoint recipe) under
*Working style → REST API design*. Read that before touching
`src/api.ts` or adding/changing any `/api/v1/...` call.

## Architecture

Vue 3 + composition API. No router, no Vuex/Pinia — `App.vue` is a
router-shell: masthead + modals + cross-cutting state, then
`<XxxView v-if="view === '…'" />` mounts one of four view SFCs:
`SettingsView`, `IngestView`, `MatchesView`, `UnknownMapsView`
(all in `frontend/src/components/`). Per-card UI state (expand,
sources, preview) lives in App.vue and is passed to MatchesView +
UnknownMapsView via the `CardStateApi` bundle exported from
MatchesView.vue so both views share it without forking.

**Layering rule:**

- **Pure helpers** (date formatting, screenshot-type detection, hero
  sorting, …) go in `match-helpers.ts` with a Vitest case.
- **Stateful logic** goes in a composable under `composables/`. Don't
  define either inside an SFC's `<script setup>`.

Existing composables fall into three groups. **Persisted-preference
family** (`ref(default)` + `setX(next)` that writes localStorage +
`onMounted` reader; add new prefs by copying one; `mountApp`'s
`MountOverrides` seeds the matching localStorage key for SFC tests):
`useTheme`, `useWeekStart`, `useIncludeUndated`, `useIncludeUnknown`,
`useLeaverHandling`, `useMinPlayThreshold`, `useShowHidden`. **Pure
stateful**: `useMatchFilters` (legacy filter refs that drive the
masthead tally + saved-view scaffolding — kept while the new
MatchesView owns its own narrow), `useMatchesNarrow` (the new
Matches-view filter state: search, picked maps/heroes/roles/results/
tags/map-types, preset + custom date range, leaver handling, dual
min-play thresholds, includeUnknown — + `narrowedRecords` /
`anyNarrow` / `activeClauseCount` computeds), `useMatchesGroup`
(sort + Y/M/W/D bucketing for the leaves list), `useMatchesDossier`
(W-L-D + winrate + top-N maps/heroes KPIs), `useTabKeyboardNav`
(WAI-ARIA Arrow/Home/End cycle over a `tabs` ref — passed from
App.vue's `visibleTabs` computed so the cycle stays inside
currently-rendered tabs; defaults to `TAB_ORDER` if no arg).
**Session-scoped
fetch**: `useOWData` (module-singleton fetching
`/api/v1/system/reference-data` once per session for canonical
hero/map display names). `ls frontend/src/composables/*.ts` is the
source of truth — don't maintain a literal list here, but the
grouping above shows the patterns to mirror when adding a new one.

The entire frontend is TypeScript (`allowJs: false`); ESLint uses
`typescript-eslint` (`tseslint.config()` in `eslint.config.js`) with
`parserOptions.parser: tseslint.parser` wired in for `.vue` files.
Template access to `Record<string, Ref<string[]>>` filter state goes
through `filterList(field)` / `filterSearchStr(field)` helpers to
satisfy `noUncheckedIndexedAccess` without littering the template
with `!` or `??`.

## Styles

Component-specific styles live in each leaf SFC's own `<style scoped>`
block (Vue rewrites every selector with a `[data-v-<hash>]` attribute
so the rule only matches that component's template).

Cross-cutting styles in `frontend/src/styles/app.css` (~1850 lines): custom properties, font-faces, theme overrides, `.btn` / `.badge` / `.chev` / `.length` / `.clickable` families, shared empty-state selectors, `.section-*` / `.setting-*` / `.settings-*` (across Settings/Ingest/Unknown), `.slot-chip` / `.slot-dot` (UnknownMapsView), `.source-name` / `.source-file` / `.source-preview` family.

When migrating a rule to scoped, check all eight component templates first — if more than one references it, keep it in `app.css`. Theme overrides DO NOT belong in scoped (Vue miscompiles `:global([data-theme="light"]) .x`; see root CLAUDE.md). Put theme-conditional rules in `app.css` under a parent id (`[data-theme="light"] #panel-settings .x`). `@keyframes` in scoped blocks get their NAME hashed, so animations used by multiple components must live in `app.css` (`pulse-dot` is canonical — used by ParseProgressPanel + IngestView).

**Custom fonts.** `frontend/src/style.css` registers `Big Noodle Too Oblique` (hero/map names + view headings) and `OW Wordmark` (masthead). Fallback chain: licensed `local()` → bundled `./assets/fonts/*.woff2` → Google Fonts lookalikes (Barlow Condensed italic, Russo One). `Futura No. 2 Demi` is declared but unused (previous "editorial Settings" scope removed — read washed-out against Big Noodle on cream). Don't reintroduce per-view typeface overrides without checking glyph density.

## App.vue concerns

State concerns owned by App.vue and passed down via props/emits:

- **Nav** — 5 tabs (4 on release builds): Settings (01), Parse (02) (internal id still `'ingest'`; `IngestView.vue` only the label changed), Matches (03) default landing, Analysis (04) — *dev-build only*, hidden when `appVersion` lacks the `-dev` suffix via `visibleTabs` computed, Unknown (05) triage. Settings owns all config (Folders/Engine/Appearance/Calendar/Backup & Restore + collapsible Advanced). Parse is just the operational loop (Watch + Manual Parse + progress panel) — don't add config rows there. Parse heading state-machine deep-links to Settings → Engine/Folders on missing-Tesseract / unset-folder.
- **Matches view layout** — `MatchesView.vue` is a *set workspace*: dossier (active-clause chips + W/L/D + top maps/heroes via `useMatchesDossier`) at top, Campaign Log (heatmap + brushable sparkline via `MatchTimelineHeader`) in the middle, compact `.leaf-row` list below with sort + Y/M/W/D grouping via `useMatchesGroup`. The left-side *"Narrow this set"* panel mirrors `MatchDetailPanel`'s modal contract (focus trap, Esc, backdrop, `inert` + `aria-hidden` on the background container while open) and consolidates every filter dimension into one place — search, date range (preset + custom), map/map-type/hero/role/result/tags, leaver handling, dual min-play thresholds, include-unknown toggle. State lives in `useMatchesNarrow`; the Map + Hero pickers reuse the `FilterCombobox` component (typeahead + selected-pill row + dropdown listbox with role="option" + aria-selected). Hero filter is **broad match** against the primary `data.hero` AND every `data.heroes_played[]` entry.
- **Date filter** only matches rows with explicit `data.date` — undated rows excluded from date-windowed views.
- **Unknown-map records hidden by default** in the Matches dossier; the narrow panel exposes a toggle to surface them for one-off investigations. The Unknown tab always shows them.
- **Tesseract gate**: `tesseractReady` computed drives a System Alert banner + disables Parse/Watch when OCR engine missing.
- **Unknown Maps view**: records with no `data.map` surface via `unknownRecords` computed.
- **Per-card expand/preview state** in plain objects, reassigned on toggle for reactivity. `screenshotURL(filename)` → `/_screenshot/<encoded>` served by `ScreenshotHandler()`.
- **Event subscription**: `EventsOn('parse-complete', load)` on mount, `EventsOff` on unmount.

## Tests

SFC-level tests use `@vue/test-utils`'s `mount()` via `mountApp(overrides?)` in `frontend/src/test-utils/mountApp.ts` (which `vi.doMock`s `./api`, so the Wails/fetch shim never fires). Pattern: `await mountApp({ records: [...] })` then assert on the wrapper's DOM. `mountApp` also exports `fireEvent(name, data?)` for driving captured `EventsOn` handlers (simulating `parse-complete` / `parse-progress`) — pair with `await flushPromises()` for async handlers.

**Two runners with disjoint file patterns.** Vitest → `src/**/*.test.ts` (unit + composable + SFC via `mount()`). Playwright → `frontend/tests/e2e/*.spec.ts` (real browser + axe-core a11y). Vitest's default discovery (`**/*.{test,spec}.ts`) WILL sweep in Playwright specs unless the include glob is pinned — loading one under Vitest crashes with `Playwright Test did not expect test.describe()`. Adding a new runner: pick an extension/dir the others don't claim AND update `vitest.config.ts` `test.include`.

**Playwright e2e.** Specs in `frontend/tests/e2e/`. `make test-e2e` builds the frontend + `serveronly` binary into `/tmp/recall-e2e/`, serves on `:7099` with `HOME=/tmp/recall-e2e`. Mock backend with `page.route('**/api/...', route => route.fulfill({status, contentType, body: JSON.stringify(...)}))` — the server stays running across tests, so route mocks are the only way to drive feature-specific fixtures. Existing files: `smoke.spec.ts` (loads, tab nav, skip-link), `a11y.spec.ts` (axe per view). Per the root CLAUDE.md TDD rule, every user-visible affordance starts with a failing spec here BEFORE implementation. Iteration loop (rebuild server on every change) is documented in root CLAUDE.md.

## Gotchas

- **Run from `frontend/`.** `npx vitest` / `npx playwright test` /
  `npm run *` need the cwd to be `frontend/`. Vitest errors with a
  misleading "Install @vitejs/plugin-vue to handle .vue files";
  Playwright errors with "two versions of @playwright/test" / "No
  tests found" because it resolves its config relative to cwd and
  the sibling `node_modules` at the repo root confuses resolution.
  Use `cd frontend && …` or `npm --prefix frontend run …`. The
  `make` targets (`make test-frontend`, `make test-e2e`, `make
  cover-frontend`) handle cwd automatically.

- **Vue 3 ref auto-unwrapping.** In `<script setup>`, refs are
  auto-unwrapped at the template top level — `myRef` in a template
  already equals `myRef.value`. Writing `myRef.value[key]` in a
  template therefore double-unwraps and returns `undefined` silently.
  Always access `.value` inside a wrapper function in TypeScript and
  call the function from the template.

- **Refs inside a prop-passed object don't auto-unwrap.** Templates
  auto-unwrap top-level refs but stop at object depth. When bundling
  a composable's return as a single prop (`CardStateApi`,
  `FiltersApi` pattern), consumers must use `.value` on the inner
  refs: `cardState.previewOpen.value[filename]`, not
  `cardState.previewOpen[filename]`. TypeScript prop types should
  declare these as `Ref<X>` so vue-tsc catches misuse.

- **`null` doesn't drop a Vue attribute.** vue-tsc rejects `null` for boolean/Booleanish attrs (`:inert`, `:aria-hidden`, `:aria-pressed`). Use `undefined`: `:inert="cond || undefined"`, `:aria-hidden="cond ? 'true' : undefined"`.

- **`loading="lazy"` breaks `v-if`-inserted images.** Browsers assign zero viewport presence to `<img>` added by `v-if`, so IntersectionObserver never fetches. Images appearing on user action must omit `loading="lazy"` (or use `eager`).

- **Use `:where()` for UA-default resets.** Promoting `<span class="badge">` → `<button class="badge">` brings back UA `appearance`/`background`/`border`/`padding`/`font` defaults. Wrap overrides in `:where(button.badge, ...) { appearance: none; ... }` so specificity stays 0 and existing `.badge` rules win.

- **A clickable container with interactive chips cannot be `role="button"`.** Nesting interactive elements is invalid HTML/ARIA and the outer role strips keyboard reach from the chips. When the row needs both an outer click handler AND inner chips, leave the container as a plain `<div>` (or `<li>` for list rows) with `@click` but no role/tabindex, and give the keyboard affordance a dedicated `<button>` inside. Canonical in the new `.leaf-row` (no outer role; click opens the detail panel) — and previously the same pattern shipped on the now-removed MatchCard.

- **happy-dom `document.activeElement` fails `.toBe(wrapper.find(...).element)`** despite identical serialization. Compare via `.id` or another attribute, not element identity.

- **Lefthook's frontend hooks (eslint/stylelint) routinely skip "no files for inspection"** even with `frontend/src/**` staged. Run `cd frontend && npx eslint 'src/**/*.{ts,vue}'` + `npx stylelint 'src/**/*.{vue,css}'` manually. `make lint` + CI catch it; only the local hook is unreliable.

- **`stylelint-config-standard` rejects BEM `--`.** `selector-class-pattern` only allows kebab-case (`.foo-modifier`, not `.foo--modifier`). Also requires empty line before every rule block (including `:hover` after `}`). Errors not warnings — most are autofixable via `npx stylelint --fix`.

- **knip project scope is `src/**/*.{ts,vue}`.** Keep `@eslint/js` in `ignoreDependencies` (typescript-eslint consumes it internally without ES-import). `@vitest/coverage-v8` doesn't need it — vitest detects via `coverage.provider: 'v8'`. Run via `make dead-code-ts`.

- **TypeScript 6.x blocked by `openapi-typescript@7.x`** (`peer typescript: "^5.x"`). Hold at `^5.x` until upstream supports TS 6.

- **Bundle-size budget enforced in CI** (`ci.yml` "Enforce bundle-size budget"): initial JS <135KB, initial CSS <80KB, total JS <270KB, total CSS <160KB. Lazy-load via `defineAsyncComponent(() => import(...))` in App.vue so only the router-shell counts toward initial budget — applies to the four view components (Matches, Ingest, Settings, Unknown) AND to any substantial modal surface (currently MatchDetailPanel, MatchScreenshotLightbox, KeyboardShortcutsModal). `App.lazy-views.test.ts` guards against regression to static `import` for every entry; a new modal needs to be added there too.

- **Nested modals: inner Esc needs CAPTURE phase + `stopImmediatePropagation`.** `useModalFocusTrap` registers Esc on `document` at bubble phase; a second modal stacked over the first (lightbox over detail panel, cheatsheet over either) can't prevent the outer trap from also firing by adding another bubble-phase listener — both run on the same target. Use `document.addEventListener('keydown', …, true)` (capture) and call `e.stopImmediatePropagation()` so the outer trap's bubble Esc never sees the event. Pattern in `MatchScreenshotLightbox.vue` + `KeyboardShortcutsModal.vue`. Same logic for the outer modal needing to suppress global shortcuts: `useKeyboardShortcuts` also installs its dispatcher at capture phase, registered at App mount before any per-modal listener — capture-phase `stopImmediatePropagation` from inside a later-mounted modal can't beat it, so the composable accepts a `suppressed: Ref<boolean>` opt-out (App.vue passes `openCheatsheet`).

- **Playwright `.click()` on a parent with `@click.stop` children.** The default `.click()` lands on the element's geometric centre. If the centre falls on a child that calls `e.stopPropagation()` (slot chips inside `.sources-toggle`, removable filter chips inside `.mf-trigger`, etc.), the parent's click handler never fires and the test waits-then-fails on state that won't change. Click a stable text-only child instead — e.g. `.sources-toggle .sources-label` — or pass `{ position: { x, y } }` to land on a known coordinate.

- **Tab visibility flows through `visibleTabs`, not just `v-if`.** Hiding a tab needs both the `<button v-if="…">` *and* the `visibleTabs` computed update — the latter feeds `useTabKeyboardNav` so ←/→ wrap-around skips the hidden tab. The panel `<v-if>` should AND the same gate as defence-in-depth (`view === 'analysis' && isDevBuild`) even though `view` is in-memory only; the gate is what keeps the WIP panel out of release renders if `view` ever gets persisted.

- **No network calls on mount unless the user asked.** The masthead update check used to fire `GET /api/v1/system/update` on every boot — replaced with a "Check for updates" button. New chrome that calls GitHub / external services should follow the same user-pulled pattern (button + Checking… state) rather than silently roundtripping at boot.

## A11y

- **Force `prefers-reduced-motion: reduce` in a11y specs** via `page.emulateMedia()` in `beforeEach`. Without it, axe-core's color-contrast check samples mid-animation alpha (`view-fade-in` ramps opacity 0→1 over 360ms) and reports legible colors as failing. `use.reducedMotion: 'reduce'` in `playwright.config.ts` does NOT work as of Playwright 1.60 — the project-level `use: { ...devices['Desktop Chrome'] }` shadows it. `page.emulateMedia()` in `beforeEach` is the only reliable lever.

- **WCAG AA on every surface.** Compute contrast for new text/accent colors against ALL of `--surface-2`, `--surface-3`, `--bg` — small UI text (≤14px non-bold) needs 4.5:1 on every surface. The ~0.4% luminance variance between surfaces is enough to flip borderline colors. OW Dark grounds on `#2a2a2a` (not the literal brand-gray `#4A4A4A`) because the latter caps the OW orange `#fa9c1b` at ~3.8:1 on the brightest surface — sub-AA. `--brand-gray` stays `#4A4A4A` as a *structural plate* token (brandmark tile, dossier surfaces) so the OW identity reads. Day's `--accent` is the same OW orange `#fa9c1b`; text-on-fill uses the `--primary-text-on-accent` token. OW Dark's `--loss` was bumped to `#f9a` (lighter pink) and `--loss-soft` opacity dropped to 8% so loss text on double-tinted bgs (a danger card containing a danger chip) clears AA.

- **A11y patterns to mirror, not reinvent.**
  - Modal dialogs: focus trap + Escape + return-focus + background
    `inert` wired inline in App.vue (`showUnsupportedModal` +
    `onModalKeydown` + the `watch(showUnsupportedModal, ...)`).
  - Tablist: Arrow/Home/End automatic-activation via
    `useTabKeyboardNav`. The cycle iterates a `tabs` ref (defaults
    to `TAB_ORDER`); App.vue passes `visibleTabs` so dev-gated tabs
    don't keyboard-trap on release builds.
  - Skip-link: `.skip-link` → `<main id="main-content" tabindex="-1">`
    with `focusMain` handler for browsers that don't move focus on
    hash navigation.
  - Reduced-motion: a global `@media (prefers-reduced-motion: reduce)`
    block at the top of App.vue's styles collapses every
    animation/transition to 0.01ms.
  - Tests for each in `App.test.ts`.
