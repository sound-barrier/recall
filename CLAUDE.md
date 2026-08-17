# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository. It holds **only what's relevant in every session**.
Directory- and topic-specific detail lives in `.claude/rules/*.md` (each loads
automatically when you touch matching files) and in `docs/dev-reference.md`
(read on demand). See the index at the bottom.

## What this project is

Recall is a Wails v3 desktop app that watches a folder of Overwatch screenshots,
OCRs them with Tesseract, merges per-match data into SQLite, and surfaces the
match history in-app — a filterable dossier plus a "Trends" section of ECharts
time-series charts (SR, win-rate, per-match stats). Stack: Go backend + Vue 3
frontend (Vite, Pinia domain stores + a thin declarative `App.vue` shell —
see `frontend/CLAUDE.md`) + `modernc.org/sqlite` (pure-Go, no CGo) + Tesseract
CLI shelled out to. The user is a competitive OW player who wants the tool to
surface what they're good/bad at by hero/map/type.

Data flow at a glance: `screenshots/*.png` → Tesseract/parser → SQLite per-type
tables (source of truth) → read-time aggregation into `match.Record` → Wails/Vue
UI (dossier + Trends charts). Full pipeline + write/read paths live in
`.claude/rules/database.md`.

The GitHub repo is `sound-barrier/recall` — used for
`gh api repos/sound-barrier/recall/...` calls (code-scanning alerts, PRs,
releases, etc.).

## Common commands

The build runner is [go-task](https://taskfile.dev) (`Taskfile.yml`, run inside the
[mise](https://mise.jdx.dev)-managed environment — `mise install` provisions the
pinned toolchain from `mise.toml`). `task --list` shows the full catalog.

| Command | Purpose |
|---|---|
| `task dev` | Hot-reload dev server (Vite `:9245` — `WAILS_VITE_PORT` overrides). Deletes the dev DB first — seed after boot. |
| `task test` | Go unit (`-race`) + Vitest. |
| `task test-e2e` | Playwright e2e. Required for any UI feature (TDD rule below). |
| `task lint` | All linters (Go × both build tags, ESLint, Stylelint, shellcheck, Spectral, taplo/sqlfluff/Biome for TOML/SQL/JSON, …). |
| `task fmt` | Go (`golangci-lint fmt` — gci import groups + gofmt -s) + shell (`shfmt`). |
| `task gen-types` | Regenerate the `frontend/src/client` SDK after editing `api/openapi.yaml`. |
| `task cover` | Generate Go + frontend **unit** coverage reports (umbrella). Required before opening a PR. |
| `task cover-e2e` | **Integration** coverage from the Playwright suite (Go `-cover` + monocart V8 frontend) → `coverage/e2e/`. Informational, not gated. |

Full command catalog, env-var overrides, package layout, and
helper-script reference: **`docs/dev-reference.md`**.

## Working style

Prescriptive defaults for how new code should be written and how changes should
be made. Override only when the user explicitly asks for something different.

For tasks that would touch more than ~3 files or restructure a package, outline
the approach first and wait for confirmation before writing code. Small changes
and Boy Scout improvements don't need ceremony; large ones shouldn't start
without agreement on direction.

### Code style

- **Go**: follow [Effective Go](https://go.dev/doc/effective_go). Accept
  interfaces, return structs. Small interfaces (1–3 methods). Composition over
  inheritance. Embedding only for behavior delegation, never just to store a
  field. No premature abstraction — three similar lines beat one abstract one.
  Do not introduce CGo dependencies; the pure-Go build constraint is
  load-bearing for the release pipeline.

- **Interface compliance — assert it at compile time.** Every concrete type that
  is meant to satisfy an interface carries a static assertion next to its
  definition so a drifting method set breaks the build at the type, not at some
  distant call site (the k8s convention): `var _ Store = (*SQLStore)(nil)`. Use
  the form that matches the receiver — `(*T)(nil)` for pointer-receiver methods,
  `T{}` for value-receiver — never both (the wrong one won't compile). Canonical
  in-repo: `pkg/db/store.go` (`*SQLStore`), `pkg/db/dbtest/fake.go` (`*Fake`). New
  implementations — including any leaf packages carved out of `pkg/app` — add the
  assertion in the same file as the type.

- **Language: American English.** All identifiers, comments, docs, commit
  messages, and user-facing copy use American spellings — color, canceled,
  organize; never the British -our/-ise/doubled-l forms. Enforced mechanically
  by `misspell` (Go, `locale: US` in `.golangci.yml`) and `typos` (repo-wide,
  `locale = "en-us"` in `_typos.toml`), both wired into CI. (The literal
  British examples can't be written here — the linters rewrite them.)

- **Naming**: identifiers must reveal intent without a comment. If you find
  yourself writing a comment to explain a name, the name is wrong — rename it.
  Abbreviations only where universally understood (`ctx`, `err`, `buf`). No
  single-letter names outside loop counters. In Go, exported names are part of
  the public contract and deserve extra care; unexported names should still be
  unambiguous in their package.

- **Function size and focus**: functions and methods should do **one thing**.
  Aim for ~25 lines as a soft ceiling. When a function grows beyond that or
  handles more than one level of abstraction, extract. The test is: can you
  describe what it does in a single clause without using "and"?

- **File length**: aim to keep source files under ~500 lines. A file past that
  is usually carrying more than one concern and wants splitting — file-per-concern
  in Go, sub-components + composables in Vue, pure helpers pulled into their own
  module. This is **best-effort, not a hard gate**: generated code, dense parser
  logic, or a single cohesive component whose bulk is irreducible markup/CSS can
  legitimately exceed it. The goal is clean, single-concern files; we recognize
  perfection isn't always reachable, so treat 500 as the direction of travel and
  call out (don't silently grow) files that blow well past it. The sibling rule
  below governs the *grouping* a file lives in.

- **Package & directory size — cohesion first, a budget as the backstop.** Size
  a grouping by responsibility: **Go** — a package is *one* cohesive
  responsibility behind a small, intentional exported API; **Vue/TS** — a folder
  is one feature's UI colocated with its state. Many files is idiomatic when
  they are one concern spelled file-per-file: `pkg/db` is the canonical
  **correctly-large** package (schema, migration engine, per-type CRUD — one
  responsibility, 30 files) and it must **not** be split to chase a number.
  But cohesion is a judgment call, and judgment calls lose to entropy. `pkg/app`
  reached 54 files one individually-defensible file at a time; a documented
  "~20–25 files" frontend ceiling sat in these rules for months while six
  directories quietly cleared it; `TECHNICAL_DEBT.md` recorded per-file growth
  triggers that three files then passed unnoticed. So every grouping also
  carries a **declared file budget** with the reason it is that number, gated by
  `scripts/ci/check-package-size.sh` against
  `scripts/ci/package-size-budgets.txt` (`task check-package-size`; CI's `lint`
  job; lefthook pre-push). **Read the numbers there, never here** — prose
  restatements drift, exactly as the coverage floors did. Budgets are
  zero-headroom on purpose: a file count moves only when someone deliberately
  adds a file, which is precisely the moment to think, so the gate trips on the
  *first* file past the line. A trip has exactly two legitimate answers.
  **Split** when the grouping really carries more than one reason to change and
  the extraction won't create an import cycle — pull pure logic into a leaf
  package the shell delegates to (`pkg/match`, `pkg/correlate`, `pkg/aggregate`
  were carved out of the former `pkg/app` god-package; the `*App` shell kept the
  wiring), or give a feature its own subfolder (`components/<feature>/`,
  `composables/<feature>/`, `shared/` for cross-feature pieces). Splitting is
  cheaper in Vue/TS than in Go — a folder has no API boundary, no import-cycle
  risk, and the `@/` alias means a moved file doesn't rewrite its own imports —
  which is why the frontend budgets sit below the Go ones. **Bump** when the new
  file is the same responsibility spelled one concern wider (a new migration, a
  new screenshot type, a new endpoint on an existing surface): raise the number,
  rewrite the WHY in the comment block directly above the entry, and append a
  row to `scripts/ci/package-size-budget-history.md`. What never justifies a
  bump: "the gate was in the way." What never justifies a split: the number
  alone — a two-file package carved out to duck a budget is a worse outcome than
  the file that tripped the gate.

- **McCabe cyclomatic complexity ≤ 10 — enforced, not aspirational.**
  `gocyclo`/`gocognit`/`funlen` (Go, `.golangci.yml`) and ESLint's
  `complexity` rule (frontend) fail the build past the threshold, production
  and test code alike — extract instead of growing branches. A justified
  inline disable (`//nolint:gocyclo // <reason>` /
  `// eslint-disable-next-line complexity -- <reason>`) is reserved for code
  where splitting genuinely hides the one algorithm (single-pass parser pixel
  scans are the canonical case); `nolintlint` and
  `reportUnusedDisableDirectives` police that every disable stays specific,
  explained, and live.

- **TypeScript / Vue**: idiomatic TS — no `any`, narrow types at boundaries
  (`Pick<>` or permissive interfaces so callers aren't forced to satisfy fields
  the function never reads). Composition API; composables for stateful logic.
  Pure helpers in `frontend/src/match/match-helpers.ts`, never inside an SFC's
  `<script setup>`. Apply the same naming discipline as Go: component props,
  composable returns, and helper functions should read like documentation.
  Follow the [Vue 3 Style Guide](https://vuejs.org/style-guide/) for component
  conventions not covered explicitly here (naming, prop casing, SFC element
  ordering).

- **Accessibility is enforced, not aspirational.**
  `eslint-plugin-vuejs-accessibility` runs in `task lint`; the axe e2e suite
  (`frontend/tests/e2e/a11y/a11y.spec.ts`) fails `task test-e2e` on any WCAG 2.1
  A/AA violation across every theme × view combination. Keep both green:
  label every control, clear AA contrast on every surface AND on a token's
  own tint, preserve the skip link, focus traps, and keyboard operability.
  Detailed patterns live in `.claude/rules/a11y.md` and `frontend/CLAUDE.md`.

- **Shell scripts**: follow the
  [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html).
  shellcheck enforces correctness; the style guide covers naming conventions,
  function structure, and quoting discipline that the linter doesn't catch.

- **Comments**: default to none. Only when the WHY is non-obvious — a hidden
  constraint, a surprising invariant, a workaround for a specific bug. Never
  re-explain WHAT the code does; well-named identifiers already do that.
  Exception: doc comments on exported Go symbols and public TypeScript APIs
  are expected — they document the contract, not the implementation.

- **Error handling — explicit and early.** Return errors; never swallow them
  silently. Avoid sentinel zero-values as implicit "no result" signals when a
  typed result or error would be clearer. Surface errors at the boundary where
  they can be meaningfully handled, not buried in helpers.

### Design principles

- **SOLID — a priority for TypeScript, a lens for Go.** In the Vue/TS code,
  treat all five as first-class design rules. In Go (not OOP) they are
  *suggestions*: apply the underlying idea where it improves testability or
  readability, never as OOP ceremony.
  - **S — Single responsibility.** A component, composable, function, or type
    does one thing (*see Function size*, *File length*). Data fetching
    (`src/queries/`), state (stores), and presentation (SFCs) are separable
    concerns; pure helpers live in `@/match/`, never inside an SFC.
  - **O — Open/closed.** Adding a variant should *extend*, not edit — prefer a
    registry keyed by a discriminant over a `switch` every new case must
    touch. Exemplars: `NARROW_CLAUSES`
    (`frontend/src/composables/matches/narrow/matchesNarrow.clauses.ts`),
    `WIDGET_REGISTRY` (`frontend/src/dashboard/widgets.ts`),
    `additiveColumns` (`pkg/db/schema.go`).
  - **L — Liskov substitution.** An implementation must honor the contract its
    callers rely on — `dbtest.Fake` passes the same Store contract suite as
    `*SQLStore`; a fake that cuts corners is a broken fake, not a shortcut.
  - **I — Interface segregation.** Depend only on what you use: small (1–3
    method) consumer-side interfaces in Go; the narrowest prop or `Pick<>` in
    TS (*see TypeScript / Vue*).
  - **D — Dependency inversion.** High-level logic depends on a seam, not a
    concrete: production wires the real implementation, tests wire a fake —
    the `db.Store` interface threaded into `*App` via `NewWithStore`; the
    frontend's `@/api-client` seam swapped with `setApiBacking()`.

- **Composition over inheritance.** Build behavior by assembling small
  collaborators, not by extending a base type. In Go, embed for behavior
  delegation only (*see Code style*) and prefer a composed interface over one
  fat type. In Vue/TS, compose components and composables; a deep hierarchy is
  a design smell, a flat set of composed parts is the goal.

- **Prefer function-variable seams over interfaces for one-method dependencies**
  (duck typing in Go). When the seam has a single method and a single fake, an
  interface is YAGNI. Examples: `runTesseractFunc` / `parseSingleFunc` in
  `pkg/parser/`.

- **Law of Demeter — accept what you read.** When a composable returns many
  refs/handlers, bundle them as a single typed prop (the `CardStateApi` /
  `FiltersApi` / `GroupingApi` pattern in `MatchesView.vue`) rather than
  threading 30 props through. Treat the bundle as opaque.

- **DRY with the rule of three.** Don't extract on the second occurrence — two
  is coincidence. The `useTheme` / `useWeekStart` / `useIncludeUndated` family
  earned the abstraction at three persisted-preference composables.

- **YAGNI — hard line.** No speculative interfaces, no "just in case" error
  handling for impossible conditions, no backwards-compat shims for undeployed
  code. If a feature is needed, the user will ask.

- **Boy Scout Rule — leave it better than you found it.** Every time you touch a
  file, improve one thing: rename a cryptic identifier, break up an oversized
  function, remove dead code, delete a stale comment, reduce a function's
  complexity by one branch. Constant, small refactors are the primary mechanism
  for keeping the codebase readable and maintainable long-term. This is not
  optional on feature or fix commits — it is part of the definition of done.

### Code smells

A smell is a *hint* to look closer, not a defect to reflexively refactor —
weigh it against YAGNI and the rule of three first (a two-case `switch` is
not yet a registry). Many below are caught mechanically: a parenthetical
marks which linter catches it (**lint**) or which rule above it restates
(*see*). The rest are review-time judgment.

**Bloaters** — grown too big to hold in your head:

- *Long method* — does more than one thing → extract (*see Function size*;
  **lint** gocyclo/gocognit/funlen, ESLint `complexity`).
- *Large class / God object* — too many responsibilities → split by concern
  (*see File length*, *Package & directory size*; the former `pkg/app`
  god-package is the in-repo cautionary tale).
- *Primitive obsession* — a bare `string`/`int` carrying domain meaning (a
  match key, a hero slug) → a named type the compiler can track.
- *Long parameter list* — 5+ positional params → bundle the cohesive ones
  into a struct/options object, or split (*see Law of Demeter*; **lint**
  ESLint `max-params` ≤ 4; Go by review).
- *Data clumps* — the same few fields travel together everywhere → give them
  a type (the `aggregate.Sidecars` shape).

**Object-orientation abusers:**

- *Type/kind `switch` every new case must edit* → a registry keyed by the
  discriminant (*see Open/closed*; **lint** `exhaustive` keeps a genuine Go
  switch honest — a Go registry *map* loses that check, so pair it with a
  completeness test, the `NARROW_CLAUSES` pattern).
- *Temporary field* — set in some flows, nil otherwise → a separate type or a
  parameter.

**Change preventers:**

- *Divergent change* — one file edited for unrelated reasons → split by
  reason to change (*see Single responsibility*).
- *Shotgun surgery* — one conceptual change touches many files → centralize
  the knowledge (one registry, constant, or helper — the pre-registry narrow
  clauses shipped a bug exactly this way).

**Dispensables:**

- *Comments as deodorant* — a comment covering for a bad name → rename; keep
  only WHY comments (*see Comments*).
- *Duplicated code* → extract on the third occurrence (*see DRY*).
- *Dead code* — unused funcs/params/vars/branches → delete (**lint** unused,
  ineffassign, unparam; deadcode + knip in CI).
- *Speculative generality* — abstraction for a caller that doesn't exist →
  delete (*see YAGNI*).
- *Middle man / lazy class* — a type that only delegates → inline it.

**Couplers:**

- *Feature envy* — a method uses another type's data more than its own →
  move it onto that type.
- *Inappropriate intimacy* — reaching into another unit's internals; tests
  asserting on privates → use the public surface (*see Test public
  interfaces*).
- *Message chains* — `a.b().c().d()` threaded through layers → pass the one
  bundled value needed (*see Law of Demeter*).

**Modern additions:**

- *Boolean/flag parameter* — `f(…, true)` that forks behavior → two
  functions or a named enum/union, so the call site reads.
- *Magic number/string* — an unexplained literal → a named constant
  (prose-only: number-literal linters over-fire on legitimate values here —
  catch it in review).
- *Deep nesting / arrow code* — pyramids of `if`/callbacks → early returns,
  guard clauses, extracted helpers (**lint** nestif; ESLint `max-depth` ≤ 4,
  `max-nested-callbacks` ≤ 3 outside tests).
- *Nested ternary* — `a ? … : b ? … : …` → a helper, lookup, or early return
  (**lint** `no-nested-ternary`).
- *Mutating a parameter* — reassigning an argument in place → return a new
  value (**lint** `no-param-reassign`).

**Go-specific:**

- `any` as a shortcut → a concrete type or a small (1–3 method) interface;
  legitimate only at true marshal/variadic boundaries (`writeJSON`,
  `emitEvent`). `gocritic` flags a range of Go micro-smells (**lint**).
- *Interface pollution* — an interface with one implementation, or defined on
  the producer side → declare it at the *consumer*, only once a second impl
  or a fake earns it; a one-method seam is a func var, not an interface
  (*see Design principles*).
- *Ignored error* — dropping a real error → handle or return it (*see
  Error handling*). errcheck catches the bare unassigned call (**lint**);
  the blank-assign `_ = f()` form passes lint (check-blank is off because
  this codebase uses it as the deliberate-drop idiom) — so a blank assign
  IS the claim "dropping this is safe", and review holds it to that.
- *Sentinel zero-value as "no result"* — `""`/`0`/`nil` meaning absence → a
  typed result or an explicit error (*see Error handling*).
- *Naked return* in more than a couple of lines → explicit values (**lint**
  nakedret).
- *Stutter* — `match.MatchRecord`, `db.DBHealth` → drop the package prefix:
  `match.Record`, `db.Health`. Review-caught, NOT lint-caught here:
  revive's `exported` rule carries the stutter check, and it is
  deliberately disabled for the no-mandatory-doc-comments policy.
- *Premature goroutines/channels* — concurrency with no measured need →
  simple synchronous code first (*see YAGNI*).

**Vue-specific:**

- *`watch`/`watchEffect` as derived state* — writing a ref a `computed`
  could express declaratively → derive during render; an effect is for real
  external side effects.
- *Side effects in a `computed`* — a getter that writes state, fires
  requests, or touches the DOM → move the effect out; getters stay pure.
- *Shadow state* — copying a prop/store value into a local `ref` "for
  editing" with no explicit sync contract → `computed` get/set or an
  explicit draft+commit.
- *Prop mutation* — assigning to a prop or mutating a prop-passed object
  (**lint** vue/no-mutating-props). Data flows down; store actions flow up.
- *Giant SFC* — markup + business logic + styles past ~500 lines → pure
  logic to `@/match/`, stateful logic to a composable, style bulk to a
  scoped sibling stylesheet (`<style scoped src="./x.css">` keeps hash
  scoping and chunk placement).
- *Fetch outside the query layer* — a component or watcher fetching server
  state directly → `src/queries/` owns server state (see
  `frontend/CLAUDE.md`).
- *Prop drilling / emit relay chains* — threading values through layers that
  don't read them → components read the Pinia stores directly (this repo's
  documented inversion of the generic advice).
- *Un-`markRaw`'d composable bundle on a store* — Pinia's `reactive()`
  deep-unwraps the bundle's inner refs and silently breaks them
  (load-bearing gotcha in `frontend/CLAUDE.md`).
- *`v-if` with `v-for` on one node* (**lint** vue flat/recommended);
  *array index as `:key`* on reorderable lists — review-caught: the
  preset only checks that a `:key` exists, and an index satisfies it.
- *Manual DOM access* — `document.querySelector` in a component → template
  refs (destructured to top-level consts — dotted `ref="obj.prop"` silently
  registers nothing).

**TypeScript-specific:**

- `any` → a real type, or `unknown` narrowed at the boundary (**lint**
  `no-explicit-any`).
- *Assertion over narrowing* — `x as T` / non-null `x!` to silence the
  checker → a type guard or an honest check (`noUncheckedIndexedAccess`
  index access in numeric kernels is the accepted exception).
- `enum` → a union of string literals, which needs no runtime shape.
- *Over-wide boundary type* — forcing callers to satisfy fields you never
  read → narrow with `Pick<>` or a permissive local interface (*see
  TypeScript / Vue*).

### TDD process

For **new features and bug fixes**:

1. **RED first.** Write a failing test that reproduces the bug or demonstrates
   the feature's contract. Run it. Watch it fail with a message that names the gap.
2. **GREEN minimal.** Smallest production change that makes the test pass. Resist
   scope creep.
3. **REFACTOR if it earns it.** Clean up only when the resulting shape is
   genuinely better. Mechanical reshuffling is noise.

For bug fixes specifically: the failing test that reproduces the bug is the most
valuable artifact in the commit — it documents both the bug and the contract
that prevents its return. Do **not** write the fix first and add a test "to
cover it"; ordering matters.

**Test public interfaces, not internals — black-box only.** Go tests declare
`package <pkg>_test` (the external test package), so only exported identifiers
are even reachable; unexported access goes through one `export_test.go` shim
per package that re-exports what the external tests need (exemplars:
`pkg/cmd/export_test.go`, `pkg/parser/export_test.go`). Frontend unit tests
drive components through Testing Library queries — role, then label, then
visible text; a structural selector (`data-*`, class) is an escape hatch that
carries a justified lint-disable — and stores through their public actions +
the `setApiBacking` seam. Assert on user-facing semantics (visible text, ARIA
state, behavior), never on styling classes. Tests coupled to internal data
structures are brittle, resist refactoring, and should be rewritten or
deleted. If something seems untestable black-box, that is a design smell —
fix the API, don't white-box the test.

**The unit ban list is mechanical.** `no-restricted-syntax` in
`frontend/eslint.config.js` fails the build on `toHaveClass`, `toHaveStyle`,
a `.style`/`.className`/`.classList` read inside `expect()`, and
`toHaveAttribute`/`getAttribute` on a `data-*` name — because each of those
asserts the paint or the wiring instead of the contract. The escape is an
annotated `// eslint-disable-next-line no-restricted-syntax -- <reason>`, kept
honest by `reportUnusedDisableDirectives`. Legitimate reasons are narrow:
aria-hidden decoration, a visual tint encoding a threshold, and a `data-*`
attribute **production code reads back** (`data-widget-id` for the drag
engine, `data-combo-id` for click-outside). When a test wants a value the
markup only paints, give the markup the semantics instead: a meter carries
`role="progressbar"` + `aria-valuenow` on its FILL element (never the track,
whose visible text must stay in the a11y tree), and the test reads
`getByRole('progressbar', { name: 'lijiang tower share' })`.

**Playwright e2e has its own ladder**, and it is not the unit ban list.
Native queries first — `getByRole` / `getByLabel` / `getByText` /
`getByTestId` — enforced by `playwright/prefer-native-locators`, which
forbids spelling an already-accessible query as a CSS selector
(`locator('[role=tab]')`, `locator('[data-testid=x]')`). Below that,
`data-*` and class-state pins ARE sanctioned: the built page is the public
surface here, and a compact structural hook beats a brittle text match for
rows, chips, and panels that carry no accessible handle. Two harnesses are
named exemptions that must not be "fixed": `elo/elo-scenarios.spec.ts` sweeps 21
attributes whose NAMES are the snapshot schema, and
`a11y/a11y-theme-snapshot.spec.ts` probes `[class*=…]` families by documented
design. Tabs whose accessible name
grows a suffix (Matches' filters dot, Unknown's badge count) are queried with
an anchored regex — `{ name: /^Matches/ }` — never an exact string.

**Coverage floors live in the gates, not this file:** Go = `GO_COVERAGE_MIN`
in `Taskfile.yml`; frontend = `coverage.thresholds` in
`frontend/vitest.config.ts`. Read the numbers there — prose restatements
drift (they did, three ways). Floors are minimums, not targets: aim higher
where the code is consequential (parser logic, aggregation, error paths),
and ratchet a floor deliberately when a campaign lifts real coverage
(release-time ratchet policy in CONTRIBUTING.md). PRs that regress a gate
without explicit justification should not merge.

**Exempt** (no TDD ceremony): typo fixes, doc-only edits, formatter/linter
passes, dependency bumps, configuration-only changes. Use judgment for
refactors — extracting a helper rarely needs a new test, but changing observable
behavior does.

**UI features need a failing Playwright e2e first.** Any feature that adds or
changes a user-visible affordance (button, filter, card state, modal, view)
starts with a RED `frontend/tests/e2e/<feature>/*.spec.ts` — the specs live in
feature folders, helpers stay at the `tests/e2e/` root — driving it through a
real browser via `page.route()` mocks. Unit tests cover render branches and
composable contracts, but only the e2e proves the full transport chain
(api.ts ↔ /api/* ↔ Go handler ↔ Store ↔ aggregator ↔ Vue render). "Stitching a
known pattern across layers" is NOT an exemption — the match-deletion feature
shipped with a latent `r.json()`-on-204 bug because no e2e exercised the
POST → reload round-trip.

**Before declaring any task done**, run `task lint` and `task test`. If UI was
touched, also run `task test-e2e`. Never present work as complete while the
build is red or tests are failing — say what's broken and why instead.

### What to avoid

The quick list; see **Code smells** above for the full catalog and what's
lint-enforced. Speculative interfaces; abstract layers without a second
concrete caller; backwards-compat shims for unreleased code; "just in case"
error handling for impossible conditions; over-engineering for hypothetical
future requirements; tests that assert on unexported identifiers or internal
data structures rather than observable, public behavior.

## Cross-cutting conventions

- **New dependencies require approval.** Do not add new Go modules (`go get`)
  or npm packages without first proposing the dependency and getting explicit
  approval. Prefer the standard library and packages already in `go.mod` /
  `package.json`. When a new dep is genuinely the right call, name it and
  explain why before adding it.

- **Week-long dependency age gate, both ecosystems.** Never adopt a version
  published less than 7 days ago — freshly compromised releases are usually
  detected and yanked within days. npm enforces it mechanically
  (`frontend/.npmrc` `min-release-age=7`; details in CONTRIBUTING.md). Go has
  no native gate: before `go get`, check the version's publish date
  (`curl https://proxy.golang.org/<module>/@v/<version>.info`) and pick an
  older one if it's younger than a week — and read `go get`'s retraction
  warnings while you're there (a cooldown once selected a retracted
  `modernc.org/libc` while excluding its fix). **Known-CVE fixes override the
  cooldown — always**: the gate guards against *unknown* freshly compromised
  releases, not *published* security fixes. npm: `--min-release-age=0` +
  name the CVE in the commit body; Go: just `go get` the fixed version.

- **Deliberate version holds — behind latest for a reason, not neglect.** Do
  not bump these without clearing the stated blocker: **typescript** `~6.0.x`
  (tilde-pinned — typescript-eslint peers `typescript <6.1.0`; revisit when
  `npm view typescript-eslint peerDependencies` admits ≥6.1);
  **@playwright/test** exact pin (bumps are deliberate, never a silent range
  resolve — 1.61's Linux WebKit crashed two e2e specs on CI; verify both
  WebKit specs per bump); **@hey-api/openapi-ts** exact pin (ships hundreds
  of 0.x versions — pick a new one deliberately, ≥7 days old, regenerate +
  diff `src/client`); **wails/v3 + wails3 CLI + @wailsio/runtime** move in
  lockstep (the CLI generates bindings the module must understand — bump all
  three in one commit); the **npm `overrides` block** pins transitive-CVE
  fixes (drop an entry once the direct dep ships a fixed tree).

- **Use `tmp/` under the repo root for ad-hoc scratch files — never `/tmp/...`
  or any path outside the repo root.** PR-body drafts, intermediate `jq` output,
  scratch scripts, log dumps — use `tmp/foo.md` (gitignored). **Carve-out**:
  existing infra paths (`/tmp/recall-e2e/...`, `HOME=/tmp/recall-smoke`,
  `/private/tmp/...` for the macOS Tesseract symlink) are baked into
  Taskfile/CI/scripts and stay as-is — but don't add new ad-hoc `/tmp` paths.

- **Commits**: Conventional Commits prefix (`feat` `fix` `chore` `docs`
  `refactor` `test` `perf` `build` `ci` `revert` `style`) enforced by lefthook's
  `commit-msg` + Linux-kernel-style body (subject ≤ 72 chars imperative
  no-period; body wrapped at 72 explaining *why*). One logical change per commit.
  release-please reads the prefix for version bumps. Bypass once with
  `LEFTHOOK_EXCLUDE=conventional`. Example in CONTRIBUTING.md.

- **Pull requests only; no direct commits to main.** Every change lands via a
  branch + PR + green CI. Branch naming mirrors the Conventional Commits prefix
  the resulting commit will carry: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`,
  `chore/<slug>`, `refactor/<slug>`, etc. So `git log --branches` reads the same
  way the commit messages do. Exceptions:
  - **release-please's own merge commits** — bot-authored, already PR-routed; the
    merge commit IS the PR landing.
  - **dependabot bumps** — bot-authored PRs that auto-merge on green CI; the PR
    exists, the human review is the auto-merge label.
  - **emergency hotfix path** — still requires a PR but allows
    `LEFTHOOK_EXCLUDE=<hook> git push` to bypass a specific blocking hook. Tag
    the PR `emergency` and open a follow-up "fix the hook" PR within 48 hours
    so the bypass doesn't become the new normal.

  Branch protection on `main` (Settings → Branches → main → "Require pull
  request before merging" + "Require status checks to pass") is the mechanical
  enforcement; this rule documents the convention even when the UI flip lags.

- **Releases are the maintainer's trigger to pull — Claude prepares, never
  publishes.** Cutting a release ships a GitHub Release + a signed container that
  users pull; it can't be cleanly unpublished. "Cut / ship / release vX.Y.Z"
  authorizes **preparation only**. Claude must **not** — without an instruction
  naming that exact action in the moment — merge release-please's Release PR
  (`chore(main): release …`), push a `v*` tag, run `task release-beta` /
  `task release-fire`, fire `release.yml`, or `gh pr merge --admin` a release.
  When prep is done, print the one command the maintainer runs to publish, then stop.
  - **Allowed prep — the `Release-As` commit may go straight to `main`.** To force
    a specific version, Claude MAY push the documented `Release-As:` prep commit
    directly to `main`: the `chore: cut vX.Y.Z` subject + `Release-As: X.Y.Z`
    footer form in `RELEASES.md` (e.g. commit `3eb065a`). It only makes
    release-please retarget the Release PR — it publishes nothing and is
    reversible — so it's exempt from "no direct commits to main" above. The human
    still merges the Release PR.

- **Breaking changes are fine — just declare them.** Pre-1.0 the project isn't
  contractually stable; any layer can change. Use `feat!:` (exclamation marks
  the whole commit breaking) or a `BREAKING CHANGE: <line>` footer. Both produce
  a minor bump pre-1.0 (`bumpMinorPreMajor: true`), major after 1.0. The marker
  MUST be where release-please can find it (subject or footer) or it ships as a
  silent patch. Don't add backwards-compat shims to "soften the landing" —
  declare and break clean.

- **Match key is identity** — never key on filename; the match key derives from
  the earliest screenshot's filename timestamp and survives re-parses. (URL-safe
  format + migration details in `.claude/rules/api-design.md`.)

- **`ls <dir>/*.go` is the source of truth** for file-per-concern packages — do
  not maintain literal file lists in any CLAUDE.md or rule.

## Where the rest lives (index)

These load automatically when you open a matching file:

| Area | Rule file | Triggers on |
|---|---|---|
| HTTP / REST API surface | `.claude/rules/api-design.md` | `api/**`, `pkg/cmd/**`, `frontend/src/api.ts` |
| Database, schema, migrations | `.claude/rules/database.md` | `pkg/db/**` |
| OCR parsers | `.claude/rules/parser.md` | `pkg/parser/**` |
| App shell | `.claude/rules/app-shell.md` | `pkg/app/**` |
| Frontend (Vue) | `frontend/CLAUDE.md` (nested; auto-loads when you read files in `frontend/`) | `frontend/**` |
| Accessibility | `.claude/rules/a11y.md` | `frontend/src/App.vue`, `frontend/src/components/**`, `frontend/src/styles/**`, `frontend/tests/**` |
| CI/CD workflows | `.claude/rules/ci-cd.md` | `.github/**` |
| Build / tooling / scripts | `.claude/rules/build-tooling.md` | `Taskfile.yml`, `mise.toml`, `Dockerfile*`, `scripts/**`, `lefthook.yml` |
| Documentation site | `.claude/rules/docs-site.md` | `docs/**`, `book/**`, root `*.md` |

Read on demand (never auto-loaded): **`docs/dev-reference.md`** — full make-target
catalog, env-var table, package layout, helper scripts, test
fixtures.

> Auto memory is on by default (Claude Code ≥ v2.1.59). New debugging insights
> get recorded automatically — you don't need to hand-append "conventions" here
> anymore. Run `/memory` to review what's been saved.
