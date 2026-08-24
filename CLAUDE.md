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

- **Language: American English.** All identifiers, comments, docs, commit
  messages, and user-facing copy use American spellings — color, canceled,
  organize; never the British -our/-ise/doubled-l forms. Enforced mechanically
  by `misspell` (Go, `locale: US` in `.golangci.yml`) and `typos` (repo-wide,
  `locale = "en-us"` in `_typos.toml`), both wired into CI. (The literal
  British examples can't be written here — the linters rewrite them.)

- **Language style lives with the language.** Go — `pkg/CLAUDE.md`, which names
  [Effective Go](https://go.dev/doc/effective_go) and
  [Google's Go Style Guide](https://google.github.io/styleguide/go/) as the
  baseline and then states only what Recall enforces on top. Vue/TypeScript —
  `frontend/CLAUDE.md`, which does the same with the
  [Vue 3 Style Guide](https://vuejs.org/style-guide/). Shell —
  [Google's Shell Style Guide](https://google.github.io/styleguide/shellguide.html),
  with shellcheck enforcing correctness and the guide covering the naming and
  quoting discipline it does not catch.

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
  triggers that three files then passed unnoticed. So every grouping answers to
  a file budget, gated by `scripts/ci/check-package-size.sh` against
  `scripts/ci/package-size-budgets.txt` (`task check-package-size`; CI's `lint`
  job; lefthook pre-push). Most groupings answer to the **default** and are not
  listed at all — registration is earned by size, which is what keeps that file
  short and every line in it load-bearing; a directory large enough to need its
  own number carries it there **with the reason it is that number**. **Read the
  numbers there, never here** — prose restatements drift, exactly as the
  coverage floors did. Budgets are zero-headroom in both directions: the gate
  trips on the *first* file past the line, and equally on a budget left sitting
  ABOVE its directory's count, because a forgotten post-split ratchet is how a
  folder silently regrows what it just shed. A trip has two legitimate answers.
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
    callers rely on; a fake that cuts corners is a broken fake, not a shortcut.
  - **I — Interface segregation.** Depend only on what you use: small (1–3
    method) consumer-side interfaces in Go; the narrowest prop or `Pick<>` in
    TS (*see `frontend/CLAUDE.md`*).
  - **D — Dependency inversion.** High-level logic depends on a seam, not a
    concrete: production wires the real implementation, tests wire a fake —
    the `db.Store` interface threaded into `*App` via `NewWithStore`; the
    frontend's `@/api-client` seam swapped with `setApiBacking()`.

- **Composition over inheritance.** Build behavior by assembling small
  collaborators, not by extending a base type. In Go, embed for behavior
  delegation only (*see Code style*) and prefer a composed interface over one
  fat type. In Vue/TS, compose components and composables; a deep hierarchy is
  a design smell, a flat set of composed parts is the goal.

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
  into a struct/options object, or split (**lint**
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
  bundled value needed (*see the Law-of-Demeter bundles in `frontend/CLAUDE.md`*).

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
**Language-specific smells live with the language.** The Go cluster (`any` as a
shortcut, interface pollution, ignored errors, sentinel zero-values, naked
returns, stutter) is in `pkg/CLAUDE.md`; the Vue and TypeScript clusters
(`watch`-as-derived-state, prop mutation, giant SFCs, assertion-over-narrowing,
`enum`, over-wide boundary types) are in `frontend/CLAUDE.md`. They were listed
here when this file was the only one; splitting them put each beside the linter
that catches it.

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

**Test public interfaces, not internals — black-box only.** Assert on
user-facing semantics (visible text, ARIA state, behavior), never on styling
classes or internal data structures — tests coupled to those are brittle, resist
refactoring, and should be rewritten or deleted. If something seems untestable
black-box, that is a design smell: fix the API, don't white-box the test.

How each language enforces that — Go's external test package and its one
`export_test.go` shim, the frontend's Testing Library query ladder and the
`setApiBacking` seam — is in `pkg/CLAUDE.md` and `frontend/CLAUDE.md`.

**The frontend's two test ladders** — the mechanical unit ban list
(`no-restricted-syntax`) and the Playwright locator ladder, which are
deliberately different from each other — are in `frontend/CLAUDE.md`, along with
the rule that a user-visible affordance starts with a failing e2e.

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

**Before declaring any task done**, run `task lint` and `task test`. If UI was
touched, also run `task test-e2e`. Never present work as complete while the
build is red or tests are failing — say what's broken and why instead.

**`task lint` green is not CI green.** Two gates cannot live in it, because
both need a production build or a running server: the **bundle-size budget**
(`scripts/ci/check-bundle-size.sh`) and the **schemathesis API-drift fuzz**.
Both fail in CI on a branch that lints clean locally, and both have done
exactly that. Before opening a PR that touched the frontend or `api/`, run
**`task verify`** — the full local battery, including those two plus the
coverage gate and the Playwright smoke subset. (`task cover` is the narrower
must-run before any PR; the full catalog is in `docs/dev-reference.md`.)

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

- **Deliberate version holds — behind latest for a reason, not neglect.** Some
  pins are load-bearing and must not be bumped without clearing a stated
  blocker. The npm inventory (typescript's ceiling, @playwright/test,
  @hey-api/openapi-ts, the 13 lockstep `@tiptap/*` packages, the `overrides`
  block) lives in `frontend/CLAUDE.md` beside the `package.json` it governs.
  The one that spans both ecosystems stays here: **wails/v3 + the wails3 CLI +
  @wailsio/runtime move in lockstep**, because the CLI generates bindings the
  Go module must understand — bump all three in one commit.

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

## Where the rest lives (index)

This file holds what is true everywhere. The two languages own their own
standards, in tracked files that load when you open their code:

| Language | File | Loads for |
|---|---|---|
| **Go** | `pkg/CLAUDE.md` | everything under `pkg/` — plus `.claude/rules/go-style.md`, a pointer with no content of its own, for the six Go files outside it |
| **Vue / TypeScript** | `frontend/CLAUDE.md` | everything under `frontend/` |

Domain rules load on their own globs, and are complementary — the files above
are about the language, these are about the subject:

| Area | Rule file | Triggers on |
|---|---|---|
| HTTP / REST API surface | `.claude/rules/api-design.md` | `api/**`, `pkg/cmd/**`, `frontend/src/api.ts` |
| Database, schema, migrations | `.claude/rules/database.md` | `pkg/db/**` |
| OCR parsers | `.claude/rules/parser.md` | `pkg/parser/**` |
| App shell | `.claude/rules/app-shell.md` | `pkg/app/**` |
| Accessibility | `.claude/rules/a11y.md` | `frontend/src/App.vue`, `frontend/src/components/**`, `frontend/src/styles/**`, `frontend/tests/**` |
| CI/CD workflows | `.claude/rules/ci-cd.md` | `.github/**` |
| Build / tooling / scripts | `.claude/rules/build-tooling.md` | `Taskfile.yml`, `mise.toml`, `Dockerfile*`, `scripts/**`, `lefthook.yml` |
| Documentation site | `.claude/rules/docs-site.md` | `docs/**`, `book/**`, root `*.md` |

Read on demand (never auto-loaded): **`docs/dev-reference.md`** — the full task
catalog, env-var table, package layout, helper scripts, and test fixtures.

> Auto memory is on by default (Claude Code ≥ v2.1.59). New debugging insights
> get recorded automatically — you don't need to hand-append "conventions" here
> anymore. Run `/memory` to review what's been saved.
