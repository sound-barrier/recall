# Frontend (`frontend/src/App.vue`)

This file is auto-loaded by Claude Code when working in `frontend/`.
The root `CLAUDE.md` carries the cross-cutting project context.

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

Existing composables: `useTheme` / `useWeekStart` / `useIncludeUndated`
(persisted-preference family — `ref(default)` + `setX(next)` that
writes localStorage + `onMounted` reader; add new prefs by copying
one; `mountApp`'s `MountOverrides` seeds the matching localStorage
key for SFC tests), `useFilterPanel` (popover open/close, ESC +
outside-click), `useMatchFilters` (7 filter refs plus `includeUndated`,
date range, sort, filtered/sorted computeds — most complex, highest
test ROI), `useMatchGrouping` (Month→Week→Day tree plus expand
state), `useOWData` (module-singleton fetching `/api/owdata` once
per session for canonical hero/map display names).

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

Cross-cutting / shared styles stay in `frontend/src/styles/app.css`
(~1 850 lines, down from ~3 700): custom properties, font-faces,
theme overrides, the `.btn` family, `.badge` family, `.chev`,
`.length`, `.clickable`, shared empty-state selectors, `.section-*`
/ `.setting-*` / `.settings-*` (used across Settings + Ingest +
Unknown views), `.slot-chip` / `.slot-dot` (shared between
MatchCard's sources-coverage strip and UnknownMapsView's slot row),
and the `.source-name` / `.source-file` / `.source-preview` family
(shared between MatchCard and UnknownMapsView).

When migrating a new rule to scoped, check all eight component
templates first; if more than one references the class, leave it in
`app.css`. Theme overrides in a scoped block need
`:global([data-theme="light"])` so the selector pierces the scope
hash. `@keyframes` defined in a scoped block get their NAME hashed,
so animations referenced from multiple components must live in
`app.css` (`pulse-dot` is the canonical example — referenced by
ParseProgressPanel + IngestView).

**Custom fonts.** `frontend/src/style.css` registers three OW
typefaces (`Big Noodle Too Oblique` for hero/map names, `Futura No.
2 Demi` for the Settings tab, `OW Wordmark` for the RECALL masthead)
with a fallback chain: licensed `local()` lookup → bundled
`./assets/fonts/*.woff2` (drop-in slot for the licensed files) →
Google Fonts free lookalikes loaded via `index.html` (Barlow
Condensed italic, Jost, Russo One). Keep all three layers when
reworking the font stack.

## App.vue concerns

State concerns owned by App.vue and passed down via props/emits:

- **Nav** — four tabs in workflow order: **Settings (01)**, **Ingest
  (02)**, **Matches (03)** (default landing), **Unknown (04)**
  (triage). The numbering communicates user flow, not tab importance.
  Settings and Ingest both wear `class="settings"` for shared layout
  but Ingest gets the modifier `ingest-view` so the Futura font scope
  (`.settings:not(.unknown-view, .ingest-view)`) stays on the actual
  Settings tab.
- **Filters**: multi-select popovers (mode/map/type/role/hero/result)
  plus date range inputs and sort dir. Each filter field is a `ref([])` —
  empty = no filter, multiple entries = union (OR). `filterRefs` maps
  field name → ref so `toggleFilter(field, value)` and card badge
  clicks share one handler. `openFilter` tracks the one currently
  open; outside-click and ESC close it via document-level listeners.
- **Hero filter** matches primary (`data.hero`) OR any secondary in
  `data.heroes_played[]` — picking Juno + Kiriko surfaces matches
  where either was played, even as second-fiddle.
- **Date filter** only matches rows with explicit `date + finished_at`
  (no `match_key` fallback), so undated rows are correctly excluded
  from date-windowed views.
- **Tesseract gate**: `tesseractReady` computed drives a System Alert
  banner and disables Parse/Watch controls when the OCR engine isn't
  found.
- **Unknown Maps view**: records where `data.map` is absent surface
  in the Unknown view via the `unknownRecords` computed.
- **Per-card expand/preview state** in plain objects, reassigned on
  toggle for Vue reactivity. `screenshotURL(filename)` returns
  `/_screenshot/<encoded>` served by `ScreenshotHandler()`.
- **Event subscription**: `EventsOn('parse-complete', load)` on mount,
  `EventsOff` on unmount.

## Tests

SFC-level tests use `@vue/test-utils`'s `mount()` via the
`mountApp(overrides?)` helper in `frontend/src/test-utils/mountApp.ts`,
which `vi.doMock`s `./api` so the Wails/fetch shim never fires
during mount. `App.test.ts` shows the pattern: `await mountApp({
records: [...] })` then assert on the wrapper's DOM.

`mountApp` exports `fireEvent(name, data?)` for tests that drive a
captured `EventsOn` handler (simulating `parse-complete` from the
watcher or `parse-progress` mid-flight). Pair with `await
flushPromises()` when the handler is async — most are.

**Two test runners; each owns a disjoint file pattern.** Vitest reads
`src/**/*.test.ts` (unit + composable + SFC tests via `mount()`).
Playwright reads `frontend/tests/e2e/*.spec.ts` (real browser,
axe-core a11y). Vitest's default discovery (`**/*.{test,spec}.ts`)
WILL sweep in Playwright specs unless the include glob is pinned —
loading a Playwright spec under Vitest crashes with `Playwright Test
did not expect test.describe() to be called here`. Adding a new
runner: pick a file extension or directory the existing runners
don't claim, AND update `vitest.config.ts` `test.include`.

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

- **`null` doesn't drop a Vue attribute the way you'd hope.** vue-tsc
  rejects `null` for boolean/Booleanish attrs (`:inert`,
  `:aria-hidden`, `:aria-pressed`). Use `undefined` to omit:
  `:inert="cond || undefined"`, `:aria-hidden="cond ? 'true' :
  undefined"`.

- **`loading="lazy"` breaks `v-if`-inserted images.** Browsers assign
  zero viewport presence to `<img>` added to the DOM by `v-if`, so
  the Intersection Observer never fetches. Any image that appears on
  explicit user action must omit `loading="lazy"` (or use `eager`).

- **Use `:where()` for UA-default resets.** Promoting a `<span
  class="badge">` to a `<button class="badge">` brings back UA
  `appearance`/`background`/`border`/`padding`/`font` defaults. Wrap
  the overrides in `:where(button.badge, ...) { appearance: none;
  ... }` so specificity stays 0 and the existing `.badge` rules win.
  Pattern in `MatchCard.vue`'s scoped `<style>` block.

- **A clickable container that holds interactive chips cannot be
  `role="button"`.** Nesting interactive elements is invalid HTML +
  ARIA and the outer role strips keyboard reach from the chips.
  Pattern in MatchCard.vue: outer `<div class="match-header">` keeps
  `@click` but no role/tabindex; a dedicated `<button
  class="chev-btn" aria-expanded>` on the right is the keyboard
  expand affordance.

- **happy-dom `document.activeElement` fails `.toBe(wrapper.find(...).element)`.**
  The two references serialize identically but the `.toBe` reference
  check fails (vitest reports "serializes to the same string").
  Compare via `(document.activeElement as HTMLElement)?.id` or
  another attribute instead of element identity.

- **Lefthook's frontend hooks (eslint/stylelint) routinely skip with
  "no files for inspection"** even when `frontend/src/**` is staged.
  Run `cd frontend && npx eslint 'src/**/*.{ts,vue}'` and `npx
  stylelint 'src/**/*.{vue,css}'` manually after frontend edits. Full
  `make lint` and CI both catch issues; only the local pre-commit
  hook is unreliable.

- **`stylelint-config-standard` rejects BEM `--` modifiers.**
  `selector-class-pattern` only allows kebab-case, so
  `.foo--modifier` is invalid. Use `.foo-modifier`. Also requires an
  empty line before every rule block (`rule-empty-line-before`),
  including `:hover` pseudo-selectors that follow a closing `}`.
  Errors, not warnings — fail `make lint`. Most stylelint errors
  here are autofixable: `cd frontend && npx stylelint --fix
  "src/**/*.{css,vue}"`.

- **knip project scope is `src/**/*.{ts,vue}`.** `@eslint/js` must
  stay in `ignoreDependencies` in `frontend/knip.config.ts`:
  typescript-eslint consumes it internally but doesn't ES-import it,
  so knip can't detect the usage. `@vitest/coverage-v8` does NOT
  need `ignoreDependencies` — vitest detects it via
  `coverage.provider: 'v8'`. Run via `make dead-code-ts` or `cd
  frontend && npm run dead:ts`.

- **TypeScript 6.x is blocked by `openapi-typescript`.**
  `openapi-typescript@7.x` declares `peer typescript: "^5.x"` and
  `npm install` fails with `ERESOLVE` if `typescript` is bumped to
  `^6.x`. Hold at `^5.x` until `openapi-typescript` ships TS 6
  support.

- **Bundle-size budget is enforced in CI.** Four limits in `ci.yml`
  "Enforce bundle-size budget": initial JS < 130 KB, initial CSS <
  80 KB, total JS < 250 KB, total CSS < 120 KB. The four view
  components (Matches, Ingest, Settings, Unknown) are lazy-loaded
  via `defineAsyncComponent` in App.vue so each emits its own Vite
  chunk and only the masthead/router-shell code counts toward the
  initial budget — `App.lazy-views.test.ts` is the regression guard
  against a refactor that converts a view back to a static `import`.
  Current state: ~103 KB initial JS / ~65 KB initial CSS / ~165 KB
  total JS / ~80 KB total CSS.

## A11y

- **Forces `prefers-reduced-motion: reduce`** in the Playwright a11y
  suite via `page.emulateMedia()` in a `beforeEach`. Without it,
  axe-core's color-contrast check samples mid-animation alpha — the
  `view-fade-in` keyframes ramp opacity 0→1 over 360ms and axe runs
  before that completes, so legible colors get reported as failing.
  Setting `use.reducedMotion: 'reduce'` in `playwright.config.ts`
  does NOT work as of Playwright 1.60: the project-level `use: {
  ...devices['Desktop Chrome'] }` shadows it. `page.emulateMedia()`
  in `beforeEach` is the only reliable lever. Any new a11y spec must
  do the same.

- **`--text-faint` luminance was bumped to clear WCAG 2 AA on
  `--surface-3`.** Night `#6b6f7a → #878a96` (5.02:1 on surface-2,
  4.74:1 on surface-3, 5.97:1 on bg). Day `#6f6a5e → #6a655a` (5.20:1
  on surface-2, 4.72:1 on surface-3). When introducing new
  "faint"/"muted" greys, compute contrast against ALL of
  `--surface-2`, `--surface-3`, AND `--bg` — small UI text (≤14px
  non-bold) needs 4.5:1 against every surface it might land on, and
  the project's surfaces vary by ~0.4% luminance which is enough to
  flip a borderline color across the threshold.

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
