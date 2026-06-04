# Frontend (`frontend/`)

This file is auto-loaded by Claude Code when working in `frontend/`.
Cross-cutting project context lives in the root `CLAUDE.md`. The **REST API
design** rules (verbs, status codes, response shapes, the 3-step
add-an-endpoint recipe) now live in `.claude/rules/api-design.md`, which
auto-loads when you touch `frontend/src/api.ts` (or `api/**` / `pkg/cmd/**`) —
read it before adding or changing any `/api/v1/...` call.

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

Composables fall into three groups; mirror the matching exemplar when adding
one. `ls frontend/src/composables/*.ts` is the source of truth — don't enumerate
them here.

- **Persisted-preference family** — `ref(default)` + `setX(next)` that writes
  localStorage + an `onMounted` reader. Add a new pref by copying one, and have
  `mountApp`'s `MountOverrides` seed the matching localStorage key for SFC tests.
  Exemplar: `useTheme`. The shared body lives in `usePersistedRef` — it eager-
  hydrates at setup time (so first render reflects the persisted value) AND
  broadcasts a custom `recall-pref-changed` event on every successful `set()`
  so SIBLING instances of the same key re-hydrate in place. The widget-config
  popover (`WidgetConfigPopover.vue`) relies on this to push saves into the
  widget's own `useWidgetConfig` instance without coupling them through a
  parent-level write path.

- **Per-widget config (`useWidgetConfig`)** — the persisted-pref family applied
  per widget id, keyed on `localStorage['recall.dashboard.widget-config.<id>']`.
  Each `WidgetDef` in `dashboard/widgets.ts` declares a `config:
  WidgetConfigSchema<T>` field (use `EMPTY_SCHEMA` for knob-less widgets,
  `makeSchema([...])` for the rest). The schema's `fields[]` array drives both
  the runtime validator AND the auto-generated form in the gear-icon popover —
  three field kinds: `integer-choice`, `enum`, `boolean`. Widget SFCs call
  `useDossier()` + `useWidgetConfig(id, schema)` in their own `<script setup>`
  and pull their slice via the dossier's query helpers (Grafana panel-options
  pattern). To add a new configurable knob: extend the widget's schema, the
  widget reads `config.value.<knob>`, the popover renders the new field
  automatically. Tests use `mountWidget(Component, { dossier, configSeed })`
  from `test-utils/mountWidget.ts`.
- **Pure stateful** — view-local filter/sort/derived state exposed as refs +
  computeds. Exemplar: `useMatchesNarrow` (the Matches-view narrow — search,
  picked maps/heroes/roles/results/tags/map-types, preset + custom date range,
  leaver handling, dual min-play thresholds, includeUnknown, plus
  `narrowedRecords` / `anyNarrow` / `activeClauseCount`). `useTabKeyboardNav` is
  the WAI-ARIA exemplar: an Arrow/Home/End cycle over a `tabs` ref (App.vue passes
  `visibleTabs` so the cycle stays inside rendered tabs; defaults to `TAB_ORDER`).
- **Session-scoped fetch** — module-singleton that fetches once per session.
  Exemplar: `useOWData` (`/api/v1/system/reference-data` for canonical hero/map
  display names).

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

Cross-cutting styles in `frontend/src/styles/app.css` (large — confirm the size with `wc -l`, don't trust a hard-coded count): custom properties, font-faces, theme overrides, `.btn` / `.badge` / `.chev` / `.length` / `.clickable` families, shared empty-state selectors, `.section-*` / `.setting-*` / `.settings-*` (across Settings/Ingest/Unknown), `.slot-chip` / `.slot-dot` (UnknownMapsView), `.source-name` / `.source-file` / `.source-preview` family.

When migrating a rule to scoped, check all eight component templates first — if more than one references it, keep it in `app.css`. `@keyframes` in scoped blocks get their NAME hashed, so animations used by multiple components must live in `app.css` (`pulse-dot` is canonical — used by ParseProgressPanel + IngestView).

**Theme overrides DO NOT belong in `<style scoped>`.** The Vue compiler
miscompiles the `:global(X) .y { … }` partial form — it strips `.y` and emits a
bare `X { … }`, so `:global([data-theme="light"]) .link-btn { … }` becomes
`[data-theme="light"] { … }` matching `<html>` directly and polluting the whole
page once mounted (scoped tags persist in `<head>` after unmount). Put
theme-conditional rules in `app.css` under a parent id
(`[data-theme="light"] #panel-settings .x`). Verify nothing leaked:
`cd frontend && npm run build && grep -c '^\[data-theme=light\]{' dist/assets/*.css`
must stay 0. (Latent but harmless in `ParseProgressPanel.vue` /
`ParseStatusBar.vue` — color/background only.)

**Theme set is Day / Dark / Night / High contrast**, stored under
`recall.theme`. Legacy values (`light`, `ow-light`, `ow-dark`) are silently
migrated by `useTheme.parseTheme` so saved prefs survive; `dark` is
intentionally NOT migrated (the string is reused by the OW-gray palette).
Palette + contrast reasoning is in the A11y section below.

**Custom fonts.** `frontend/src/style.css` registers `Big Noodle Too Oblique` (hero/map names + view headings) and `OW Wordmark` (masthead). Fallback chain: licensed `local()` → bundled `./assets/fonts/*.woff2` → Google Fonts lookalikes (Barlow Condensed italic, Russo One). `Futura No. 2 Demi` is declared but unused (previous "editorial Settings" scope removed — read washed-out against Big Noodle on cream). Don't reintroduce per-view typeface overrides without checking glyph density.

## App.vue concerns

State concerns owned by App.vue and passed down via props/emits:

- **Nav** — 5 tabs (4 on release builds): Settings (01), Parse (02) (internal id still `'ingest'`; `IngestView.vue` only the label changed), Matches (03) default landing, Unknown (04) triage, Analysis (05) — **dev-build only**. Analysis sits LAST so its dev gate falls off the tail — Unknown stays "04" on both dev and release builds. How the gate actually works (`visibleTabs` + the keyboard-nav interaction) lives once, in the "Tab visibility" gotcha below. Settings owns all config (Folders/Engine/Appearance/Calendar/Backup & Restore + collapsible Advanced). Parse is just the operational loop (Watch + Manual Parse + progress panel) — don't add config rows there. Parse heading state-machine deep-links to Settings → Engine/Folders on missing-Tesseract / unset-folder.
- **Matches view layout** — `MatchesView.vue` is a *set workspace*: dossier (active-clause chips + W/L/D + customizable widget grid via `useMatchesDossier` + per-widget config) at top, Campaign Log (heatmap + brushable sparkline via `MatchTimelineHeader`) in the middle, compact `.leaf-row` list below with sort + Y/M/W/D grouping via `useMatchesGroup`. The left-side *"Narrow this set"* panel mirrors `MatchDetailPanel`'s modal contract (focus trap, Esc, backdrop, `inert` + `aria-hidden` on the background container while open) and consolidates every filter dimension into one place — search, date range (preset + custom), map/map-type/hero/role/result/tags, leaver handling, dual min-play thresholds, include-unknown toggle. State lives in `useMatchesNarrow`; the Map + Hero pickers reuse the `FilterCombobox` component (typeahead + selected-pill row + dropdown listbox with role="option" + aria-selected). Hero filter is **broad match** against the primary `data.hero` AND every `data.heroes_played[]` entry.

- **Dossier as data source (Grafana panel-options pattern)** — `useMatchesDossier` exposes two tiers: **bedrock refs** (no per-widget config: `wld`, `winrate`, `totalTimePlayed`, `averageKDA`, `reviewedCount`, `daysSinceLastReview`, `wldSinceLastReview`, `currentStreak`, `longestWinStreak`, `heroPoolSize`, `topRoles`) and **parameterized query helpers** (config-driven: `topByCount`, `topHeroesByMinutes`, `mostPlayedHero`, `bestWinrateHero`, `timeOfDayBuckets`, `dayOfWeekBuckets`, `recentResults`). Each helper accepts `MaybeRefOrGetter<Opts>` so widgets can wire reactive config through. `MatchesView` calls `provideDossier(useMatchesDossier(...))` once; widgets `inject` via `useDossier()` and pull only the slice they render. No HTTP per widget — the dossier is one in-memory aggregation over the narrowed records. New aggregate metrics go HERE, not into a separate computed in MatchesView; consumers reach them through the inject seam.
- **Date filter** only matches rows with explicit `data.date` — undated rows excluded from date-windowed views.
- **Unknown-map records hidden by default** in the Matches dossier; the narrow panel exposes a toggle to surface them for one-off investigations. The Unknown tab always shows them.
- **Tesseract gate**: `tesseractReady` computed drives a System Alert banner + disables Parse/Watch when OCR engine missing.
- **Unknown Maps view**: records with no `data.map` surface via `unknownRecords` computed.
- **Per-card expand/preview state** in plain objects, reassigned on toggle for reactivity. `screenshotURL(filename)` → `/_screenshot/<encoded>` served by `ScreenshotHandler()`.
- **Event subscription**: `EventsOn('parse-complete', load)` on mount, `EventsOff` on unmount.

## Tests

SFC-level tests use `@vue/test-utils`'s `mount()` via `mountApp(overrides?)` in `frontend/src/test-utils/mountApp.ts` (which `vi.doMock`s `./api`, so the Wails/fetch shim never fires). Pattern: `await mountApp({ records: [...] })` then assert on the wrapper's DOM. `mountApp` also exports `fireEvent(name, data?)` for driving captured `EventsOn` handlers (simulating `parse-complete` / `parse-progress`) — pair with `await flushPromises()` for async handlers.

**Two runners with disjoint file patterns.** Vitest → `src/**/*.test.ts` (unit + composable + SFC via `mount()`). Playwright → `frontend/tests/e2e/*.spec.ts` (real browser + axe-core a11y). Vitest's default discovery (`**/*.{test,spec}.ts`) WILL sweep in Playwright specs unless the include glob is pinned — loading one under Vitest crashes with `Playwright Test did not expect test.describe()`. Adding a new runner: pick an extension/dir the others don't claim AND update `vitest.config.ts` `test.include`.

**Playwright e2e.** Specs in `frontend/tests/e2e/`. `make test-e2e` builds the frontend + `serveronly` binary into `/tmp/recall-e2e/`, serves on `:7099` with `HOME=/tmp/recall-e2e`. Mock backend with `page.route('**/api/...', route => route.fulfill({status, contentType, body: JSON.stringify(...)}))` — the server stays running across tests, so route mocks are the only way to drive feature-specific fixtures. Existing files: `smoke.spec.ts` (loads, tab nav, skip-link), `a11y.spec.ts` (axe per view). Per the root `CLAUDE.md` TDD rule, every user-visible affordance starts with a failing spec here BEFORE implementation.

**Local iteration loop.** `reuseExistingServer: !process.env.CI` keeps
`recall-server` running across `npx playwright test` runs, but the binary embeds
`frontend/dist` at build time. After any `frontend/src/**` or `pkg/**` change,
rebuild + kill before retesting:
`cd frontend && npm run build && cd .. && go build -tags serveronly -o /tmp/recall-e2e/recall-server . && lsof -i :7099 | awk 'NR==2 {print $2}' | xargs -r kill`.
Symptom of a stale server: locator counts stay at pre-change values for ~14
polling retries despite correct `page.route()` mocks. `make test-e2e` rebuilds
for you.

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

- **A clickable container with interactive chips cannot be `role="button"`.** Nesting interactive elements is invalid HTML/ARIA and the outer role strips keyboard reach from the chips. When the row needs both an outer click handler AND inner chips, leave the container as a plain `<div>` (or `<li>` for list rows) with `@click` but no role/tabindex, and give the keyboard affordance a dedicated `<button>` inside. Canonical in the new `.leaf-row` (no outer role; click opens the detail panel).

- **happy-dom `document.activeElement` fails `.toBe(wrapper.find(...).element)`** despite identical serialization. Compare via `.id` or another attribute, not element identity.

- **Lefthook's frontend hooks (eslint/stylelint) routinely skip "no files for inspection"** even with `frontend/src/**` staged. Run `cd frontend && npx eslint 'src/**/*.{ts,vue}'` + `npx stylelint 'src/**/*.{vue,css}'` manually. `make lint` + CI catch it; only the local hook is unreliable.

- **`stylelint-config-standard` rejects BEM `--`.** `selector-class-pattern` only allows kebab-case (`.foo-modifier`, not `.foo--modifier`). Also requires empty line before every rule block (including `:hover` after `}`). Errors not warnings — most are autofixable via `npx stylelint --fix`.

- **knip project scope is `src/**/*.{ts,vue}`.** Keep `@eslint/js` in `ignoreDependencies` (typescript-eslint consumes it internally without ES-import). `@vitest/coverage-v8` doesn't need it — vitest detects via `coverage.provider: 'v8'`. Run via `make dead-code-ts`.

- **TypeScript 6.x blocked by `openapi-typescript@7.x`** (`peer typescript: "^5.x"`). Hold at `^5.x` until upstream supports TS 6. (Pin lives in `frontend/package.json` — check there for the current constraint.)

- **Bundle-size budget.** The KB thresholds live in
  `scripts/check-bundle-size.sh` (run by the `ci.yml` "Enforce bundle-size
  budget" step) — that script is the single source of truth; read the numbers
  there, don't restate them here (they've already drifted between docs once).
  Lazy-load via `defineAsyncComponent(() => import(...))` in App.vue so only the
  router-shell counts toward initial budget — applies to the four view components
  (Matches, Ingest, Settings, Unknown) AND to any substantial modal surface
  (currently MatchDetailPanel, MatchScreenshotLightbox, KeyboardShortcutsModal).
  `App.lazy-views.test.ts` guards against regression to static `import` for every
  entry; a new modal needs to be added there too.

- **Nested modals: inner Esc needs CAPTURE phase + `stopImmediatePropagation`.** `useModalFocusTrap` registers Esc on `document` at bubble phase; a second modal stacked over the first (lightbox over detail panel, cheatsheet over either) can't prevent the outer trap from also firing by adding another bubble-phase listener — both run on the same target. Use `document.addEventListener('keydown', …, true)` (capture) and call `e.stopImmediatePropagation()` so the outer trap's bubble Esc never sees the event. Pattern in `MatchScreenshotLightbox.vue` + `KeyboardShortcutsModal.vue`. Same logic for the outer modal needing to suppress global shortcuts: `useKeyboardShortcuts` also installs its dispatcher at capture phase, registered at App mount before any per-modal listener — so the composable accepts a `suppressed: Ref<boolean>` opt-out (App.vue passes `openCheatsheet`).

- **Playwright `.click()` on a parent with `@click.stop` children.** The default `.click()` lands on the element's geometric centre. If the centre falls on a child that calls `e.stopPropagation()` (slot chips inside `.sources-toggle`, removable filter chips inside `.mf-trigger`, etc.), the parent's click handler never fires and the test waits-then-fails on state that won't change. Click a stable text-only child instead — e.g. `.sources-toggle .sources-label` — or pass `{ position: { x, y } }` to land on a known coordinate.

- **Tab visibility flows through `visibleTabs`, not just `v-if`.** A tab is
  dev-gated when `appVersion` carries the `-dev` suffix (`isDevBuild`) — the
  Analysis tab is the current case. Hiding a tab needs both the
  `<button v-if="…">` *and* the `visibleTabs` computed update — the latter feeds
  `useTabKeyboardNav` so ←/→ wrap-around skips the hidden tab. The panel `<v-if>`
  should AND the same gate as defence-in-depth (`view === 'analysis' &&
  isDevBuild`) even though `view` is in-memory only; the gate keeps the WIP panel
  out of release renders if `view` ever gets persisted.

- **No network calls on mount unless the user asked.** The masthead update check used to fire `GET /api/v1/system/update` on every boot — replaced with a "Check for updates" button. New chrome that calls GitHub / external services should follow the same user-pulled pattern (button + Checking… state) rather than silently roundtripping at boot.

## A11y

Accessibility rules (axe/reduced-motion spec setup, WCAG-AA contrast math, and
the focus-trap / tablist / skip-link patterns to mirror) now live in
`.claude/rules/a11y.md`, which auto-loads when you touch components, styles,
`App.vue`, or test specs.
