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
`useTheme`, `useWeekStart`, `useIncludeUndated`, `useDensityMode`,
`useLeaverHandling`, `useMinPlayThreshold`, `useShowHidden`. **Pure
stateful**: `useFilterPanel` (popover open/close, ESC + outside-click),
`useMatchFilters` (7 filter refs + includeUndated + leaverHandling +
showHidden + date range + sort + filtered/sorted computeds — most
complex, highest test ROI), `useMatchGrouping` (Month→Week→Day tree
plus expand state). **Session-scoped fetch**: `useOWData`
(module-singleton fetching `/api/v1/system/reference-data` once per session for
canonical hero/map display names). `ls frontend/src/composables/*.ts`
is the source of truth — don't maintain a literal list here, but the
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

Cross-cutting styles in `frontend/src/styles/app.css` (~1850 lines): custom properties, font-faces, theme overrides, `.btn` / `.badge` / `.chev` / `.length` / `.clickable` families, shared empty-state selectors, `.section-*` / `.setting-*` / `.settings-*` (across Settings/Ingest/Unknown), `.slot-chip` / `.slot-dot` (MatchCard + UnknownMapsView), `.source-name` / `.source-file` / `.source-preview` family.

When migrating a rule to scoped, check all eight component templates first — if more than one references it, keep it in `app.css`. Theme overrides DO NOT belong in scoped (Vue miscompiles `:global([data-theme="light"]) .x`; see root CLAUDE.md). Put theme-conditional rules in `app.css` under a parent id (`[data-theme="light"] #panel-settings .x`). `@keyframes` in scoped blocks get their NAME hashed, so animations used by multiple components must live in `app.css` (`pulse-dot` is canonical — used by ParseProgressPanel + IngestView).

**Custom fonts.** `frontend/src/style.css` registers `Big Noodle Too Oblique` (hero/map names + view headings) and `OW Wordmark` (masthead). Fallback chain: licensed `local()` → bundled `./assets/fonts/*.woff2` → Google Fonts lookalikes (Barlow Condensed italic, Russo One). `Futura No. 2 Demi` is declared but unused (previous "editorial Settings" scope removed — read washed-out against Big Noodle on cream). Don't reintroduce per-view typeface overrides without checking glyph density.

## App.vue concerns

State concerns owned by App.vue and passed down via props/emits:

- **Nav** — 4 tabs in workflow order: Settings (01), Parse (02) (internal id still `'ingest'`; `IngestView.vue` only the label changed), Matches (03) default landing, Unknown (04) triage. Settings owns all config (Folders/Engine/Appearance/Calendar/Backup & Restore + collapsible Advanced). Parse is just the operational loop (Watch + Manual Parse + progress panel) — don't add config rows there. Parse heading state-machine deep-links to Settings → Engine/Folders on missing-Tesseract / unset-folder.
- **Filters**: multi-select popovers (mode/map/type/role/hero/result) + date range + sort. Each field is `ref([])` (empty = no filter; entries = OR). `filterRefs` maps field → ref so `toggleFilter()` and badge clicks share one handler. `openFilter` tracks the open popover; outside-click + ESC close.
- **Hero filter** matches `data.hero` OR any `data.heroes_played[]` entry — Juno+Kiriko surfaces matches where either was played.
- **Date filter** only matches rows with explicit `date + finished_at` (no `match_key` fallback) — undated rows excluded from date-windowed views.
- **Tesseract gate**: `tesseractReady` computed drives a System Alert banner + disables Parse/Watch when OCR engine missing.
- **Unknown Maps view**: records with no `data.map` surface via `unknownRecords` computed.
- **Per-card expand/preview state** in plain objects, reassigned on toggle for reactivity. `screenshotURL(filename)` → `/_screenshot/<encoded>` served by `ScreenshotHandler()`.
- **Event subscription**: `EventsOn('parse-complete', load)` on mount, `EventsOff` on unmount.

## Tests

SFC-level tests use `@vue/test-utils`'s `mount()` via `mountApp(overrides?)` in `frontend/src/test-utils/mountApp.ts` (which `vi.doMock`s `./api`, so the Wails/fetch shim never fires). Pattern: `await mountApp({ records: [...] })` then assert on the wrapper's DOM. `mountApp` also exports `fireEvent(name, data?)` for driving captured `EventsOn` handlers (simulating `parse-complete` / `parse-progress`) — pair with `await flushPromises()` for async handlers.

**Two runners with disjoint file patterns.** Vitest → `src/**/*.test.ts` (unit + composable + SFC via `mount()`). Playwright → `frontend/tests/e2e/*.spec.ts` (real browser + axe-core a11y). Vitest's default discovery (`**/*.{test,spec}.ts`) WILL sweep in Playwright specs unless the include glob is pinned — loading one under Vitest crashes with `Playwright Test did not expect test.describe()`. Adding a new runner: pick an extension/dir the others don't claim AND update `vitest.config.ts` `test.include`.

**Playwright e2e.** Specs in `frontend/tests/e2e/`. `make test-e2e` builds the frontend + `serveronly` binary into `/tmp/recall-e2e/`, serves on `:7099` with `HOME=/tmp/recall-e2e`. Mock backend with `page.route('**/api/...', route => route.fulfill({status, contentType, body: JSON.stringify(...)}))` — the server stays running across tests, so route mocks are the only way to drive feature-specific fixtures. Existing files: `smoke.spec.ts` (loads, tab nav, skip-link), `a11y.spec.ts` (axe per view). Per the root CLAUDE.md TDD rule, every user-visible affordance starts with a failing spec here BEFORE implementation. Iteration loop (rebuild server on every change) is documented in root CLAUDE.md.

## Gotchas

- **Run from `frontend/`.** `npx vitest` / `npm run *` need the cwd
  to be `frontend/` so Vite resolves `vitest.config.ts`. Running
  from repo root errors with a misleading "Install
  @vitejs/plugin-vue to handle .vue files" even though the plugin
  IS installed. Use `cd frontend && …` or `npm --prefix frontend run
  …`. The `make` targets (`make test-frontend`, `make
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

- **Use `:where()` for UA-default resets.** Promoting `<span class="badge">` → `<button class="badge">` brings back UA `appearance`/`background`/`border`/`padding`/`font` defaults. Wrap overrides in `:where(button.badge, ...) { appearance: none; ... }` so specificity stays 0 and existing `.badge` rules win. Pattern in `MatchCard.vue`.

- **A clickable container with interactive chips cannot be `role="button"`.** Nesting interactive elements is invalid HTML/ARIA and the outer role strips keyboard reach from the chips. Pattern in MatchCard.vue: outer `<div class="match-header">` has `@click` but no role/tabindex; a dedicated `<button class="chev-btn" aria-expanded>` is the keyboard affordance.

- **happy-dom `document.activeElement` fails `.toBe(wrapper.find(...).element)`** despite identical serialization. Compare via `.id` or another attribute, not element identity.

- **Lefthook's frontend hooks (eslint/stylelint) routinely skip "no files for inspection"** even with `frontend/src/**` staged. Run `cd frontend && npx eslint 'src/**/*.{ts,vue}'` + `npx stylelint 'src/**/*.{vue,css}'` manually. `make lint` + CI catch it; only the local hook is unreliable.

- **`stylelint-config-standard` rejects BEM `--`.** `selector-class-pattern` only allows kebab-case (`.foo-modifier`, not `.foo--modifier`). Also requires empty line before every rule block (including `:hover` after `}`). Errors not warnings — most are autofixable via `npx stylelint --fix`.

- **knip project scope is `src/**/*.{ts,vue}`.** Keep `@eslint/js` in `ignoreDependencies` (typescript-eslint consumes it internally without ES-import). `@vitest/coverage-v8` doesn't need it — vitest detects via `coverage.provider: 'v8'`. Run via `make dead-code-ts`.

- **TypeScript 6.x blocked by `openapi-typescript@7.x`** (`peer typescript: "^5.x"`). Hold at `^5.x` until upstream supports TS 6.

- **Bundle-size budget enforced in CI** (`ci.yml` "Enforce bundle-size budget"): initial JS <130KB, initial CSS <80KB, total JS <250KB, total CSS <120KB. The four view components (Matches, Ingest, Settings, Unknown) are lazy-loaded via `defineAsyncComponent` in App.vue so only the router-shell counts toward initial budget. `App.lazy-views.test.ts` guards against regression to static `import`. Current: ~103KB / ~65KB / ~165KB / ~80KB.

## A11y

- **Force `prefers-reduced-motion: reduce` in a11y specs** via `page.emulateMedia()` in `beforeEach`. Without it, axe-core's color-contrast check samples mid-animation alpha (`view-fade-in` ramps opacity 0→1 over 360ms) and reports legible colors as failing. `use.reducedMotion: 'reduce'` in `playwright.config.ts` does NOT work as of Playwright 1.60 — the project-level `use: { ...devices['Desktop Chrome'] }` shadows it. `page.emulateMedia()` in `beforeEach` is the only reliable lever.

- **WCAG AA on every surface.** Compute contrast for new text/accent colors against ALL of `--surface-2`, `--surface-3`, `--bg` — small UI text (≤14px non-bold) needs 4.5:1 on every surface. The ~0.4% luminance variance between surfaces is enough to flip borderline colors. Light-mode `--accent` is rust `#b03a0a` because bright `#F5A623` hit 1.78:1 on cream; `--accent-soft` / `--accent-glow` stay derived from the bright orange so highlight tints stay visible.

- **A11y patterns to mirror, not reinvent.**
  - Modal dialogs: focus trap + Escape + return-focus + background
    `inert` wired inline in App.vue (`showUnsupportedModal` +
    `onModalKeydown` + the `watch(showUnsupportedModal, ...)`).
  - Tablist: Arrow/Home/End automatic-activation in `onTabKeydown`
    over `TAB_ORDER`.
  - Skip-link: `.skip-link` → `<main id="main-content" tabindex="-1">`
    with `focusMain` handler for browsers that don't move focus on
    hash navigation.
  - Reduced-motion: a global `@media (prefers-reduced-motion: reduce)`
    block at the top of App.vue's styles collapses every
    animation/transition to 0.01ms.
  - Tests for each in `App.test.ts`.
