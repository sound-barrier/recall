# Frontend (`frontend/`)

This file is auto-loaded by Claude Code when working in `frontend/`.
Cross-cutting project context lives in the root `CLAUDE.md`. The **REST API
design** rules (verbs, status codes, response shapes, the 3-step
add-an-endpoint recipe) now live in `.claude/rules/api-design.md`, which
auto-loads when you touch `frontend/src/api.ts` (or `api/**` / `pkg/cmd/**`) —
read it before adding or changing any `/api/v1/...` call.

## Architecture

Vue 3 + composition API. No router. Cross-cutting state lives in **Pinia**
domain stores under `frontend/src/stores/` — `useAppStore` (view/nav, error
banner, version, update-check, dataLocation), `useMatchesStore` (records +
derived triage lists, the narrow/anchor filter cluster, the dossier-feeding
narrowedRecords), `useParseStore` (the parse-run lifecycle, ignored
screenshots, the pending/failed folder ledgers), `useDatabaseStore`
(clear/backup/restore/import — the whole-database operations, NOT
preferences), `useSettingsStore` (Tesseract/OCR engine, folder-watch,
screenshots-dir, theme), `useCoachStore` (the coach's open session) +
`useCoachReturnsStore` (the player's inbox of returned notes), and
`useUiStore` (detail-panel selection, screenshot preview/lightbox, card
focus, the narrow-panel + manual-match modal open-flags). `App.vue` is a thin **declarative shell** (~70
code lines, hard-capped at 200 — see "App.vue is the shell" below): it reads a
few store refs, wires the App-shell composables (`composables/app/`), and renders
the chrome (`AppMasthead`, the banners, `ParseStatusBar`) + one of four view SFCs
via `<XxxView v-if="appStore.view === '…'" />` (`SettingsView`, `IngestView`,
`MatchesView`, `UnknownMapsView`, each in its feature folder under
`frontend/src/components/`) + `AppOverlays` — **all** of which read the stores
directly (zero prop/emit drilling; the overlay cluster takes no prop bundle). It
owns **no** business logic: the boot coordinator lives in `useAppBoot` (on-mount
fan-out into each store's loaders + the non-dismissible Startup-failure modal),
keyboard wiring in
`useAppKeyboard`, the first-run gate in `useFirstRun`, the anchor toast in
`useAnchorToast`, the tour bridge in `useOnboardingTourBridge`; the SSE event
stream is wired by `useServerEvents` into the parse store, which owns the
parse lifecycle it drives.

**Store conventions (mirror the existing stores):** setup-style stores
(`defineStore('x', () => {…})`) ARE composables with a global instance — migrate
a *global* state composable by wrapping its body; consumers read state via
`storeToRefs(store)` and actions off the store directly (the SAME local names
keep call sites stable). Two gotchas, both load-bearing: (1) **`markRaw` any
composable *bundle* you expose** (the narrow API, `selection`, etc.) — Pinia's
`reactive()` store deep-unwraps nested refs and would turn `narrow.narrowedRecords`
(a Ref) into a bare value; `markRaw` keeps the inner refs intact + reactive. (2)
**Composables that use component lifecycle** (`usePersistedRef` → `onMounted`)
only work in a store because it binds to App's lifecycle on first use —
fragile for isolated tests (the matches store now builds the dossier with
`useWeekStart` under exactly this caveat: tests must seed the pref before
the store first runs). Per-instance/utility
composables (`useModalFocusTrap`, `useDragReorder`, `useWidgetConfig`, the
per-row/table view state) STAY composables — a singleton store would break them.
Tests seed stores via `setActivePinia(createPinia())` (+ `renderApp`/`renderWidget`
install a Pinia). Per-card UI state still flows to MatchesView + UnknownMapsView
via the `CardStateApi` bundle exported from MatchesView.vue.

**Vue 3 + Pinia thin-shell is the desired architecture — keep it that way.** This
is the target for all new work, not just a description of today's state. **App.vue
is the shell**: ≤200 *code* lines (comments excluded), no business logic, no
`onMounted`, no orchestration. New cross-cutting state goes in a store; new
App-shell wiring (lifecycle, keyboard, boot, a gated modal) goes in a
`composables/app/` composable App calls; a new view affordance is wired by the
view reading the store directly. Choose a **composable over a store action** when
the logic uses component lifecycle (`onMounted`) or would create an app↔domain
store import cycle — `useAppBoot` fans into the matches/settings stores' loaders
without coupling their modules; a `boot()` action on the app store would have.

**Migrate a component off props/emits by having it read the stores** (proven
across all four views + `AppMasthead`): read the stores into locals with the SAME
names the template uses (top-level refs auto-unwrap, so the template is
untouched), replace each `emit('x', …)` with the matching store action or
UI-store flag, then delete `defineProps`/`defineEmits`. Components read stores
**directly** — App does not prop-drill data down or wire mutation emits back up.
**UI open-state** (the detail-panel `selection`, screenshot `preview`,
`cardFocus`, the narrow-panel + manual-match flags) lives in `useUiStore`; App's
`backgroundFrozen` reads the flags and the owning view flips them.

**The `@/api-client` seam**: every store / composable / SFC imports its api
*functions* from `@/api-client`, NOT `@/api`. `api-client.ts` wraps `@/api` and
delegates each call to a runtime `backing` (default = the real `@/api`), so a
test swaps the whole api with `setApiBacking(mock)` instead of a module mock.
Types still come from `@/api` (re-exported by `@/api-client` too). New api
function → call it via `@/api-client`. (This replaced the multi-fork App.test
`@/api` flake + the `vi.doMock`/`resetModules`/`doUnmock` dance.)
Underneath the seam, `api.ts` is a thin named-function facade over the
**@hey-api/openapi-ts generated SDK** in `src/client/` (regenerated by
`task gen-types`; ONE fetch transport in both desktop and server modes —
the Wails asset server serves the same REST mux). The surviving dual-mode
surface (native dialogs, the events bridge, binary import/export, OpenURL)
lives in `api-platform.ts`; `ApiError` + the problem+json mapping in
`api-error.ts`; the SDK-envelope helpers in `api-unwrap.ts`. Even the
binary paths go through the SDK — only their DOM plumbing (`<a download>`,
`<input type=file>`) is hand-written.

**`IS_WAILS` (from `@/platform`) is the ONE runtime detector — never
re-derive it.** It keys off the serving origin (`wails:` scheme on macOS,
`wails.localhost` host on Windows). A `navigator.userAgent.includes('wails')`
copy reads **false in the Windows desktop build** — Wails appends that
marker to outgoing request headers only, never to the JS-visible UA — which
is how every API call once 404'd on the shipped platform, and how a
context-menu item later went missing there. Import the constant; do not
write a local one-liner. It lives in the dependency-free `@/platform` leaf
(not `api-platform.ts`, which pulls the generated SDK + the Wails runtime)
so leaf components can read it without dragging the api chain into their
chunk — that import weight is exactly why the duplicated one-liners existed.
`platform.test.ts` pins the origin matrix.

**The query layer (`src/queries/`)**: server state lives in the
**@tanstack/vue-query** cache, not in store refs. `queries/client.ts` owns
the singleton QueryClient (defaults pinned by `queries/client.test.ts`:
retry off, staleTime/gcTime Infinity, focus/reconnect refetch off,
networkMode 'always' — these ARE the no-network-on-mount rule and the e2e
request-count parity, don't loosen them casually); `queries/keys.ts` is the
key taxonomy. Query composables pass the client explicitly (2nd argument)
because observers are created during Pinia store setup, where inject()
isn't available. Stores host app-lifetime observers and expose SAME-NAMED
computeds so `storeToRefs` consumers never changed; a query opts into the
global error banner via `meta: { banner: '…' }` (identity-stable Retry
lives in the QueryCache handlers). Mutations invalidate/refetch their
NARROW scope — a match edit refetches only `qk.matches`; see
`useMatchActions` for the sanctioned scopes. Profile switches still
`window.location.reload()`, which discards the whole cache by design.

**Testing a store-reading component**: `vi.mock('@/api', …)` with `importOriginal`
overriding only the calls the test drives, `setActivePinia(createPinia())`, seed
the stores via their setters / direct state mutation, `vi.spyOn(store, 'action')`
BEFORE render, then assert the spies / api mock / store state — never the
render result's `emitted(...)` (that's for prop/emit leaf components). (A
hoisted `vi.mock('@/api')` still works — it flows through `api-client`'s real
import.) App-level tests through `renderApp` install the mock with
`setApiBacking()` on the seam — leak-immune, no module-mock dance;
`mockedApi()` returns the installed mock for call-count assertions.

**File layout — group by feature, not flat.** `components/` and `composables/`
are organized into feature subfolders, not one giant flat directory:
`components/<feature>/` (`matches/`, `settings/`, `unknown/`, `ingest/`,
`onboarding/`, `update/`, `dashboard/` — owning the widget set, nested under
`dashboard/widgets/` —, `app/` — the App-shell chrome (`AppMasthead` and its
`masthead/` pieces, the app-level modals + banners) —, `shared/`) and the
matching `composables/<feature>/`, with `shared/` holding only what more than
one feature reads (`FilterCombobox`, `TypeaheadDropdown`; on the composable
side the persisted-ref substrate plus `shared/keyboard/` and `shared/media/`).
**A file used by exactly one feature does not belong in `shared/`** — that is
how both `shared/` folders became junk drawers the first time. Colocate
a feature's UI with its state. Per the root `CLAUDE.md` *Package & directory
size* rule, each of these directories carries a declared file budget in
`scripts/ci/package-size-budgets.txt` — read the number there, and run
`task package-size-audit` to see where a folder stands. `ls` stays the source of
truth for *what is in* a folder; don't enumerate files here. (The two trees are
not required to mirror: `composables/` has no `unknown/` — no composable is
unknown-specific — and its `profile/` has no components counterpart.)

**Imports use the `@/` alias** (`@/` → `frontend/src/`) — the canonical Vue
convention, configured in `vite.config.ts` + `vitest.config.ts` (`resolve.alias`)
and `tsconfig.json` (`paths`). Import intra-`src` modules as
`@/components/<feature>/Foo.vue`, `@/composables/<feature>/useFoo`, `@/match/match-helpers`, … —
never with relative `../` chains. Location-independent paths are what let a file
move between feature folders without rewriting its own imports (the whole point
of the regroup). eslint needs no resolver plugin — its rule set never resolves
import targets; vue-tsc and knip read the tsconfig `paths` natively. `vi.doMock`
targets must use the same `@/` id as the code under test (e.g. `@/api`) so the
mock matches.

**Layering rule:**

- **Pure helpers** (date formatting, screenshot-type detection, hero
  sorting, …) go in `@/match/` (e.g. `match-helpers.ts`) with a Vitest case.
- **Stateful logic** goes in a composable under `composables/`. Don't
  define either inside an SFC's `<script setup>`.

Composables fall into three groups; mirror the matching exemplar when adding
one. `ls frontend/src/composables/**/*.ts` is the source of truth — don't enumerate
them here.

- **Persisted-preference family** — `ref(default)` + `setX(next)` that writes
  localStorage + an `onMounted` reader. Add a new pref by copying one, and have
  `renderApp`'s `MountOverrides` seed the matching localStorage key for SFC tests.
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
  and pull their slice via the dossier's query helpers (the dashboard
  panel-options pattern). To add a new configurable knob: extend the widget's schema, the
  widget reads `config.value.<knob>`, the popover renders the new field
  automatically. Tests use `renderWidget(Component, { dossier, configSeed })`
  from `@/test-utils`.
- **Pure stateful** — view-local filter/sort/derived state exposed as refs +
  computeds. Exemplar: `useMatchesNarrow` (the Matches-view narrow — search,
  picked maps/heroes/roles/results/tags/map-types, preset + custom date range,
  leaver handling, dual min-play thresholds, includeUnknown, plus
  `narrowedRecords` / `anyNarrow` / `activeClauseCount`). `useTabKeyboardNav` is
  the WAI-ARIA exemplar: an Arrow/Home/End cycle over `TAB_ORDER`.
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

**`vue-tsc` is the type-check source of truth — not typescript-eslint.**
The type-aware ESLint rules run a *separate* TS program (`projectService`)
that can't fully resolve this codebase's large Pinia setup-store +
openapi-generated (`@/api`) types, so they disagree with `vue-tsc` (the
build's real type gate) at those boundaries — reporting "type could not be
resolved" / phantom-`any` where `vue-tsc` resolves the type correctly. **When
a type-aware rule flags — or its `--fix` removes — something `vue-tsc`
accepts, eslint is wrong.** Never `eslint --fix` a sweep of type-aware
findings, or suppress one, without running `npx vue-tsc --noEmit` first; a
`--fix` once silently stripped load-bearing `as` casts and broke the build.
This is why `no-unsafe-*`, `no-unnecessary-type-assertion`, and `require-await`
are deliberately off (per-rule rationale in `eslint.config.js`); the 16
enabled type-checked rules are the ones that agree with `vue-tsc`. Corollary:
**don't export a shared type from a `.vue` `<script>`** — typescript-eslint
can't resolve a type across the SFC boundary (it reads as an error/`any`
type); put it in a sibling `.ts` module (e.g. `parse-progress.ts`).

## Styles

Component-specific styles live in each leaf SFC's own `<style scoped>`
block (Vue rewrites every selector with a `[data-v-<hash>]` attribute
so the rule only matches that component's template).

Cross-cutting styles live under `frontend/src/styles/`. `app.css` is a thin `@import` index over topical files (`tokens`, `themes`, `chrome`, `masthead`, `buttons`, `states`, `badges`, `nav`, `settings`, `system-alert`, `responsive`, `overrides`, `components`) — **the `@import` order IS the cascade order; keep it.** These hold custom properties, font-faces, theme overrides, the `.btn` / `.badge` / `.chev` / `.length` / `.clickable` families, shared empty-state selectors, `.section-*` / `.setting-*` / `.settings-*` (across Settings/Ingest/Unknown), `.slot-chip` / `.slot-dot` (UnknownMapsView), the `.source-*` family, etc. Add a global rule to the matching topical file; create a new one + `@import` it (in cascade position) for a genuinely new family.

When migrating a rule to scoped, check all eight component templates first — if more than one references it, keep it in `app.css`. `@keyframes` in scoped blocks get their NAME hashed, so animations used by multiple components must live in `app.css` (`pulse-dot` is canonical — used by ParseProgressPanel + IngestView).

**One visual concept = one rule.** The small uppercase kicker had grown 40+
near-identical definitions (`.kpi-eyebrow`, `.breakdown-eyebrow`,
`.np-section-eyebrow`, …) across 6 font sizes and 6 letter-spacings before it was
collapsed to `.eyebrow` (+ `.accent` / `.alert` modifiers) in `badges.css`.
Components add `eyebrow` for the type and keep their own class only for LAYOUT.
Reach for the shared class; if a new variant seems needed, add a modifier rather
than a parallel family. `tests/e2e/a11y/a11y-theme-snapshot.spec.ts` records the set
of DISTINCT computed values per family, so a reintroduced one-off shows up as a
snapshot diff that has to be justified.

**The paper family is a SURFACE, not a palette.** `styles/paper.css` gives the
coaching session its ink-on-paper look, and `.paper` works by re-mapping
`--text*`, `--accent-text`, `--win|loss|draw` and `--hairline` to the ink/paper
tokens **inside itself** — so `.eyebrow`, `.badge`, `.score-num` and
`MatchRankBlock` render correctly on paper with no parallel rules to keep in
sync. Put a component on paper by adding `.paper`, never by restyling its type.
Per-theme differences are token overrides only (`--paper`, `--ink`, …), which is
what keeps `check-css-theme-leak` green. Two traps already paid for: `--accent`
is unreadable on paper (use `--paper-accent`), and `--text-mute` drops to 3.98:1
on Day's darker surfaces — small content text takes `--text-dim`.

**Use the design tokens — stylelint enforces it.**
`scale-unlimited/declaration-strict-value` fails the build on a literal for any
`*-color`, `fill`, `stroke`, `font-size`, `border-radius`, or
`transition-duration`. The scales live in `styles/tokens.css` (per-theme values
in `themes.css`): `--type-4xs … --type-7xl` (14 stops, 0.5–1.65rem), `--space-1
… --space-7`, `--radius-hair/-/-md/-lg/-pill`, `--duration-instant … -hero`.
Anything derived from a token passes, so `color-mix(in srgb, var(--accent) 22%,
transparent)` and `rgb(var(--shadow-rgb) / 55%)` are fine. Exempt by design:
display type ≥1.8rem (per-surface editorial, not scale points), `em` units,
`@keyframes`/`animation` timings, and the definition files themselves. A genuine
one-off gets a `stylelint-disable-next-line … --` with the reason, not a config
loosening.

**`--accent` is the CHROME token; `--accent-text` is the TYPE token.** Under
Day, `--accent` is the bright OW orange at 1.9:1 on cream — fine for a border,
fill or glow, unreadable as text. They're identical under the three dark themes,
so the distinction only bites on Day and is easy to get wrong. Same shape for
`--primary-text-on-accent` / `--primary-text-on-danger` (text sitting ON a
colored fill) and `--on-dark-plate` (text on the brand-gray tile, which stays
dark under every theme).

**New colors must clear AA on every surface AND on their own tint.** Check
against `--surface`, `--surface-2`, `--surface-3`, `--bg` — and, for a token
used as text over its own soft variant (a win chip is `color: var(--win)` on
`background: var(--win-soft)`), against that composite too. That last case is
what put Day's win/loss/draw at 3.8–4.2:1 for a long time.

**Theme overrides DO NOT belong in `<style scoped>`.** The Vue compiler
miscompiles the `:global(X) .y { … }` partial form — it strips `.y` and emits a
bare `X { … }`, so `:global([data-theme="day"]) .link-btn { … }` becomes
`[data-theme="day"] { … }` matching `<html>` directly and polluting the whole
page once mounted (scoped tags persist in `<head>` after unmount). Put
theme-conditional rules in a `styles/*.css` file under a parent id
(`[data-theme="day"] #panel-settings .x`). **`scripts/ci/check-css-theme-leak.sh`
is the gate** (`task check-css-themes`, and a CI step): it fails on any bare
`[data-theme=X]{…}` block that sets real properties — palette blocks setting only
`--*` are fine — and on any rule targeting a theme mode `useTheme` never writes.
It replaced a manual `grep -c '^\[data-theme=light\]{'` that was anchored with
`^` against Vite's minified single-line CSS and so reported 0 while three real
leaks shipped.

**Theme set is Day / Dark / Night / High contrast**, stored under
`recall.theme`. Legacy values (`light`, `ow-light`, `ow-dark`) are silently
migrated by `useTheme.parseTheme` so saved prefs survive; `dark` is
intentionally NOT migrated (the string is reused by the OW-gray palette).
Palette + contrast reasoning is in the A11y section below.

**Custom fonts.** `frontend/src/style.css` registers `Big Noodle Too Oblique` (hero/map names + view headings) and `OW Wordmark` (masthead). Fallback chain: licensed `local()` → Google Fonts lookalikes (Barlow Condensed italic, Russo One). The proprietary cuts aren't redistributable, so there's no bundled `.woff2` (the old `url('./assets/fonts/*')` refs were dead in every shipped build and produced vite "didn't resolve" warnings; removed). `Futura No. 2 Demi` is declared but unused (previous "editorial Settings" scope removed — read washed-out against Big Noodle on cream). Don't reintroduce per-view typeface overrides without checking glyph density.

## App.vue concerns

State concerns — now owned by the Pinia domain stores (see Architecture) and
read directly by App.vue + the views; the notes below describe the behavior,
not the wiring:

- **Every view is a tab — `ViewId = TabId`.** The coaching Film Room used to be
  the one view outside the tablist (`ViewId = TabId | 'coach'`, a masthead
  `rovingTab` hack, an off-list fallback in `useTabKeyboardNav`); it now renders
  INSIDE the 07 Reviews tab (`ReviewsView` shows the room while a coach session
  is active, the index otherwise). The masthead is a `v-for` over `TABS`
  (derived from `TAB_ORDER` + `TAB_LABELS` in `useTabKeyboardNav.ts`) — a new
  tab is one entry there plus its lazy view; the number is the index. Don't
  reintroduce a view id that is not in `TAB_ORDER`.
- **`useWriteGate()` is the one place writes are refused.** `writesLocked =
  isReadOnly || sessionActive`; every writer calls `guardWrite()` first and every
  affordance that could start a write disables with `lockReason` in its title.
  The frontend gate is defense in depth — the server refuses the same writes with
  a 409 — but a button that stays enabled is still a lie to the user.
- **Nav** — seven tabs, in `TAB_ORDER`: Settings (01), Parse (02) (internal id still `'ingest'`; `IngestView.vue` only the label changed), Matches (03) default landing, Unknown (04) triage, Compare (05), Elo Calculator (06), Reviews (07 — the review cycle, and the film room while a coach session is open). Settings owns all config (Folders/Engine/Appearance/Calendar/Backup & Restore + collapsible Advanced). Parse is just the operational loop (Watch + Manual Parse + progress panel) — don't add config rows there. Parse heading state-machine deep-links to Settings → Engine/Folders on missing-Tesseract / unset-folder.
- **Matches view layout** — `MatchesView.vue` is a *set workspace*: dossier (active-clause chips + W/L/D + customizable widget grid via `useMatchesDossier` + per-widget config) at top, Campaign Log (heatmap + brushable sparkline via `MatchTimelineHeader`) in the middle, compact `.leaf-row` list below with sort + Y/M/W/D grouping via `useMatchesGroup`. The left-side *"Narrow this set"* panel mirrors `MatchDetailPanel`'s modal contract (focus trap, Esc, backdrop, `inert` + `aria-hidden` on the background container while open) and consolidates every filter dimension into one place — search, date range (preset + custom), map/map-type/hero/role/result/tags, leaver handling, dual min-play thresholds, include-unknown toggle. State lives in `useMatchesNarrow`; the Map + Hero pickers reuse the `FilterCombobox` component (typeahead + selected-pill row + dropdown listbox with role="option" + aria-selected). Hero filter is **broad match** against the primary `data.hero` AND every `data.heroes_played[]` entry.

- **Dossier as data source (dashboard panel-options pattern)** — `useMatchesDossier` exposes two tiers: **bedrock refs** (no per-widget config: `wld`, `winrate`, `totalTimePlayed`, `averageKDA`, `reviewedCount`, `daysSinceLastReview`, `wldSinceLastReview`, `currentStreak`, `longestWinStreak`, `topRoles`) and **parameterized query helpers** (config-driven: `topByCount`, `topHeroesByMinutes`, `mostPlayedHero`, `bestWinrateHero`, `timeOfDayBuckets`, `dayOfWeekBuckets`, `recentResults`). Each helper accepts `MaybeRefOrGetter<Opts>` so widgets can wire reactive config through. `MatchesView` calls `provideDossier(useMatchesDossier(...))` once; widgets `inject` via `useDossier()` and pull only the slice they render. No HTTP per widget — the dossier is one in-memory aggregation over the narrowed records. New aggregate metrics go HERE, not into a separate computed in MatchesView; consumers reach them through the inject seam.
- **Date filter** places rows via `matchTime()` — SUMMARY `data.date`+`finished_at`, else the match key's capture timestamp, else bare `data.date`; optional HH:MM bounds tighten a day to a minute (naive local, both ends inclusive, record truncated to the minute). Rows with no placeable time (`unmatched-`/`ambiguous-` sentinels) pass every range; the dossier's own date-windowed views still require explicit `data.date`.
- **Unknown-map records hidden by default** in the Matches dossier; the narrow panel exposes a toggle to surface them for one-off investigations. The Unknown tab always shows them.
- **Tesseract gate**: `tesseractReady` computed drives a System Alert banner + disables Parse/Watch when OCR engine missing.
- **Unknown Maps view**: records with no `data.map` surface via `unknownRecords` computed.
- **Per-card expand/preview state** in plain objects, reassigned on toggle for reactivity. `screenshotURL(filename)` → `/_screenshot/<encoded>` served by `ScreenshotHandler()`.
- **Event subscription**: `EventsOn('parse-complete', load)` on mount, `EventsOff` on unmount.

## Tests

SFC-level tests use **Testing Library** (`@testing-library/vue` + jest-dom +
user-event) — `@vue/test-utils` is banned in `src/**/*.test.ts` (eslint
`no-restricted-imports`; it survives only as a transitive dep of
`@testing-library/vue`). Query ladder: `getByRole(name)` > `getByLabelText` >
`getByText` > a justified `querySelector` escape hatch annotated with
`eslint-disable-next-line testing-library/no-node-access -- <reason>`.

**What you may NOT assert** (`no-restricted-syntax`, error): `toHaveClass`,
`toHaveStyle`, a `.style` / `.className` / `.classList` read inside `expect()`,
and `toHaveAttribute` / `getAttribute` on a `data-*` name. Setup-time writes
(`el.style.width = …` in a fixture) stay legal — the rules are scoped to
`expect()`. The escape is an annotated
`// eslint-disable-next-line no-restricted-syntax -- <reason>`; the sanctioned
reasons are aria-hidden decoration, a visual tint encoding a threshold
(`bucketCellClass`, `row.judgment`, diff row tints), a `data-*` the app itself
reads back (`data-widget-id` → drag engine, `data-combo-id` → click-outside),
and focus/source-order pins no TL query expresses.

**Meters carry their value in ARIA.** A share/winrate/progress bar puts
`role="progressbar"` + `aria-valuenow` (+ `aria-valuemin`/`max`, or
`aria-valuetext` for non-percent units) on the **fill** element, never on the
`.bd-bar` track — a progressbar makes its children presentational, and the
track holds visible text (`.bd-time`) that must stay in the a11y tree. The
accessible name is identity-only (`` `${row.key} winrate` ``) — with one
deliberate exception: a bar whose TINT passes judgment appends that
judgment to its name (`` `Wed share — winning` ``), because a verdict
carried by color alone is no verdict at all for a screen-reader or
colorblind player (WCAG 1.4.1). The vocabulary is a single lookup,
`JUDGMENT_LABEL` in `@/match/trends/match-heatmap-helpers`, keyed by the same
band the class is — so a band cannot gain a color without gaining a
word. The rule is scoped to surfaces where the tint is the ONLY cue: a
heatmap cell is a bare colored button, so it speaks its band, while the
hero-pool and Elo-picker rows print `11x · 64%` in text beside the bar
and are left alone (a redundant encoding is not a 1.4.1 failure). The
number still lives in `aria-valuenow`, so tests read
`getByRole('progressbar', { name: 'ana winrate' })` and assert the attribute.
An indeterminate bar omits `aria-valuenow` rather than lying with 0. App-level
tests use `renderApp(overrides?)` from `@/test-utils` (installs an api mock via
`setApiBacking()` on the `@/api-client` seam, so the Wails/fetch shim never
fires): `await renderApp({ records: [...] })` then assert via `screen`. The
barrel also exports `fireBackendEvent(name, data?)` for driving captured
`EventsOn` handlers (simulating `parse-complete` / `parse-progress`) — pair with
`await flushPromises()` (also from `@/test-utils`) for async handlers — plus
`renderWidget` for dashboard widgets (fragment roots: query via `screen`, not
`container`). Import TL query APIs from `@testing-library/vue` (one dom
instance) and always import the harness from the `@/test-utils` BARREL — the
eslint plugin's `utils-module: '@/test-utils'` detection keys on that exact
specifier. Known happy-dom gotcha: user-event's awaited chains can silently
drop dispatches on store-backed views whose vue-query notify re-renders between
queued events — fall back to TL `fireEvent` there (equivalent to VTU's old
`trigger()`).

**Query-cache test hygiene.** The QueryClient is reached ONLY through
`getQueryClient()` — never a module-level `const` — because it lives in a
`globalThis` slot: a test file running `vi.resetModules()` would otherwise
end up with two clients, one held by the freshly-imported components and
another by whatever imported the module earlier (that split silently broke
a test's cache clear once). `vitest.setup.ts` installs a FRESH client
before each test via `resetQueryClient()` (dynamically imported at
teardown — a static import there would drag the app module graph, and with
it a real `@/api`, into every file before its own `vi.mock` could apply)
and `afterEach(cleanup)` tears down Testing Library renders (test.globals is
off, so TL's auto-cleanup never self-registers — the explicit hook is
mandatory). Two rules when a test touches
server state: (1) **seed the cache BEFORE the store exists** —
`seedQuery(qk.x, data)` (from `@/test-utils/queryTestUtils`) ahead of the
first `useXStore()` call means the observer sees fresh data and never
fires the initial fetch that would clobber the seed when its mock
resolves; (2) query results land after the notifyManager's scheduling —
await a macrotask (`await new Promise(r => setTimeout(r, 0))`), not just
`flushPromises()`, before asserting on freshly-fetched state.

**Two runners with disjoint file patterns.** Vitest → `src/**/*.test.ts` (unit + composable + SFC via Testing Library `render()`). Playwright → `frontend/tests/e2e/**/*.spec.ts` (real browser + axe-core a11y). Vitest's default discovery (`**/*.{test,spec}.ts`) WILL sweep in Playwright specs unless the include glob is pinned — loading one under Vitest crashes with `Playwright Test did not expect test.describe()`. Adding a new runner: pick an extension/dir the others don't claim AND update `vitest.config.ts` `test.include`.

**Playwright e2e.** Specs in `frontend/tests/e2e/<feature>/` — one folder per feature area (`matches`, `match`, `dossier`, `data-table`, `narrow`, `trends`, `unknown`, `coach`, `elo`, `dashboard`, `onboarding`, `update`, `parse`, `settings`, `a11y`, `app`); pick the one whose surface the spec drives. The `tests/e2e/` ROOT holds only the shared harness: the `_*.ts` helpers (import them as `'../_fixtures'`) and the `coverage-*.ts` files `playwright.config.ts` names by path. The two `*-snapshots/` directories also stay at the root and are found by BASENAME (`snapshotPathTemplate` is `{testDir}/{testFileName}-snapshots/`), so two specs must never share a basename across folders. `task test-e2e` builds the frontend + `serveronly` binary into `/tmp/recall-e2e/`, serves on `:7099` with `HOME=/tmp/recall-e2e`. Mock backend with `page.route('**/api/...', route => route.fulfill({status, contentType, body: JSON.stringify(...)}))` — the server stays running across tests, so route mocks are the only way to drive feature-specific fixtures. Start here: `app/smoke.spec.ts` (loads, tab nav, skip-link), `a11y/a11y.spec.ts` (axe per view). Per the root `CLAUDE.md` TDD rule, every user-visible affordance starts with a failing spec here BEFORE implementation.

**The e2e locator ladder is NOT the unit ban list.** Native queries come first
and `playwright/prefer-native-locators` enforces it: `locator('[role=tab]')`,
`locator('[data-testid=x]')`, `locator('[aria-label=…]')` and the
title/placeholder/alt forms are errors, because each spells an already-accessible
query as CSS. Below that tier, `data-*` and class-state pins are **sanctioned** —
the built page is the public surface here, and a compact hook beats a brittle
text match on rows/chips/panels with no accessible handle. Tabs and panels are
queried by role; the two whose accessible name grows a suffix use an anchored
regex (`getByRole('tab', { name: /^Matches/ })` — the filters dot; `/^Unknown/` —
the badge count). Named exemptions from the rule, deliberately structural:
`elo/elo-scenarios.spec.ts` (its 21-attribute sweep — the attribute NAMES are the
snapshot schema) and `a11y/a11y-theme-snapshot.spec.ts` (`[class*=…]` family probes).
Route-callback captures go through `routeCapture<T>()` in `tests/e2e/_capture.ts`,
and nullable reads through its `must()` — the specs are type-checked by
`tsconfig.e2e.json` (`npm run typecheck:e2e`), so `as`-casting past a null is a
build failure, not a habit.

**Local iteration loop.** `reuseExistingServer: !process.env.CI` keeps
`recall-server` running across `npx playwright test` runs, but the binary embeds
`frontend/dist` at build time. After any `frontend/src/**` or `pkg/**` change,
rebuild + kill before retesting:
`cd frontend && npm run build && cd .. && go build -tags serveronly -o /tmp/recall-e2e/recall-server . && lsof -i :7099 | awk 'NR==2 {print $2}' | xargs -r kill`.
Symptom of a stale server: locator counts stay at pre-change values for ~14
polling retries despite correct `page.route()` mocks. `task test-e2e` rebuilds
for you.

## Gotchas

- **Match time: display from the canonical UTC instant, not the naive OCR
  fields.** `data.date`/`data.finished_at` are the OW scoreboard's naive local
  wall clock (no timezone); `data.played_at_utc` is the backend-derived canonical
  UTC (RFC3339). Human-display helpers (`fmtTime`, `formatRowDate`,
  `formatFinishedAt`) prefer `matchInstantUTC(rec)` rendered in the viewer's
  current zone (`formatLocalFromUTC`, sharing `formatParsedAt`'s convention) and
  fall back to the naive strings for rows without the column (backfilled by
  Re-parse All). For a stationary viewer the output is identical to the naive
  render. The SORT/compare key (`matchTime`) is intentionally still the naive
  string — don't "fix" it to UTC without checking #607's date-range predicate and
  the heatmap/grouping helpers, which compare against it.

- **Run from `frontend/`.** `npx vitest` / `npx playwright test` /
  `npm run *` need the cwd to be `frontend/`. Vitest errors with a
  misleading "Install @vitejs/plugin-vue to handle .vue files";
  Playwright errors with "two versions of @playwright/test" / "No
  tests found" because it resolves its config relative to cwd and
  the sibling `node_modules` at the repo root confuses resolution.
  Use `cd frontend && …` or `npm --prefix frontend run …`. The
  `task` targets (`task test-frontend`, `task test-e2e`, `task
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

- **Lefthook's frontend hooks (eslint/stylelint) routinely skip "no files for inspection"** even with files staged. Run `cd frontend && npm run lint:js` (`eslint .` — the WHOLE tree: src, tests, e2e specs, config files, `.cjs` scripts; only generated artifacts in `eslint.config.js`'s `ignores` are exempt) + `npx stylelint 'src/**/*.{vue,css}'` manually. `task lint` + CI catch it; only the local hook is unreliable.

- **`stylelint-config-standard` rejects BEM `--`.** `selector-class-pattern` only allows kebab-case (`.foo-modifier`, not `.foo--modifier`). Also requires empty line before every rule block (including `:hover` after `}`). Errors not warnings — most are autofixable via `npx stylelint --fix`.

- **knip project scope is `src/**/*.{ts,vue}`.** No `ignoreDependencies` needed: knip ≥6.23 resolves typescript-eslint's internal `@eslint/js` use (the old ignore entry now trips a "remove from ignoreDependencies" hint), and `@vitest/coverage-v8` is detected via `coverage.provider: 'v8'`. Run via `task dead-code-ts`.

- **The TypeScript ceiling: typescript-eslint is the binding blocker.**
  `typescript-eslint`'s peer (`>=4.8.4 <6.1.0`, every `@typescript-eslint/*`
  package) admits TS 6.0.x but caps us below 6.1/7, and dropping it isn't
  on the table given the 16 type-checked rules + `projectService` wired up
  in `eslint.config.js`. `typescript` is pinned `~6.0.x` (TILDE — a caret
  would let installs drift past the 6.1 ceiling; the old second blocker,
  openapi-typescript's `^5.x` peer, died with the generator swap to
  `@hey-api/openapi-ts`). TS 6 note: `baseUrl` is deprecated — `paths`
  resolve relative to the tsconfig, don't reintroduce it. **Revisit when
  typescript-eslint publishes a `typescript` peer admitting ≥6.1** (check
  with `npm view typescript-eslint peerDependencies`, don't assume).
  `@hey-api/openapi-ts` stays EXACT-pinned (it ships hundreds of 0.x
  versions — pick a new one deliberately, ≥7 days old per the `.npmrc`
  cooldown, and regenerate + diff `src/client`).

- **Bundle-size budget.** The KB thresholds live in
  `scripts/ci/check-bundle-size.sh` (run by the `ci.yml` "Enforce bundle-size
  budget" step) — that script is the single source of truth; read the numbers
  there, don't restate them here (they've already drifted between docs once).
  Lazy-load via `defineAsyncComponent(() => import(...))` in App.vue so only the
  router-shell counts toward initial budget — applies to the four view components
  (Matches, Ingest, Settings, Unknown) AND to any substantial modal surface
  (currently MatchDetailPanel, MatchScreenshotLightbox, KeyboardShortcutsModal).
  `App.lazy-views.test.ts` guards against regression to static `import` for every
  entry; a new modal needs to be added there too.

- **Nested modals: inner Esc needs CAPTURE phase + `stopImmediatePropagation`.** `useModalFocusTrap` registers Esc on `document` at bubble phase; a second modal stacked over the first (lightbox over detail panel, cheatsheet over either) can't prevent the outer trap from also firing by adding another bubble-phase listener — both run on the same target. Use `document.addEventListener('keydown', …, true)` (capture) and call `e.stopImmediatePropagation()` so the outer trap's bubble Esc never sees the event. Pattern in `MatchScreenshotLightbox.vue` + `KeyboardShortcutsModal.vue`. Same logic for the outer modal needing to suppress global shortcuts: `useKeyboardShortcuts` also installs its dispatcher at capture phase, registered at App mount before any per-modal listener — so the composable accepts a `suppressed: Ref<boolean>` opt-out (App.vue passes `openCheatsheet`).

- **Playwright `.click()` on a parent with `@click.stop` children.** The default `.click()` lands on the element's geometric center. If the center falls on a child that calls `e.stopPropagation()` (slot chips inside `.sources-toggle`, removable filter chips inside `.mf-trigger`, etc.), the parent's click handler never fires and the test waits-then-fails on state that won't change. Click a stable text-only child instead — e.g. `.sources-toggle .sources-label` — or pass `{ position: { x, y } }` to land on a known coordinate.

- **No network calls on mount unless the user asked.** The masthead update check used to fire `GET /api/v1/system/update` on every boot — replaced with a "Check for updates" button. New chrome that calls GitHub / external services should follow the same user-pulled pattern (button + Checking… state) rather than silently roundtripping at boot.

## A11y

Accessibility rules (axe/reduced-motion spec setup, WCAG-AA contrast math, and
the focus-trap / tablist / skip-link patterns to mirror) now live in
`.claude/rules/a11y.md`, which auto-loads when you touch components, styles,
`App.vue`, or test specs.
