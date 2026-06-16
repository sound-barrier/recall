# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository. It holds **only what's relevant in every session**.
Directory- and topic-specific detail lives in `.claude/rules/*.md` (each loads
automatically when you touch matching files) and in `docs/dev-reference.md`
(read on demand). See the index at the bottom.

## What this project is

Recall is a Wails v2 desktop app that watches a folder of Overwatch screenshots,
OCRs them with Tesseract, merges per-match data into SQLite, and optionally
exposes the match history as Prometheus metrics so a bundled Grafana dashboard
can chart trends. Stack: Go backend + Vue 3 frontend (Vite) +
`modernc.org/sqlite` (pure-Go, no CGo) + Tesseract CLI shelled out to. The user
is a competitive OW player who wants the tool to surface what they're good/bad
at by hero/map/type.

Data flow at a glance: `screenshots/*.png` → Tesseract/parser → SQLite per-type
tables (source of truth) → read-time aggregation into `MatchRecord` → Wails/Vue
UI **and** Prometheus → Grafana. Full pipeline + write/read paths live in
`.claude/rules/database.md`.

The GitHub repo is `sound-barrier/recall` — used for
`gh api repos/sound-barrier/recall/...` calls (code-scanning alerts, PRs,
releases, etc.).

## Common commands

The build runner is [go-task](https://taskz.dev) (`Taskfile.yml`, run inside the
[mise](https://mise.jdx.dev)-managed environment — `mise install` provisions the
pinned toolchain from `mise.toml`). `task --list` shows the full catalog.

| Command | Purpose |
|---|---|
| `task dev` | Hot-reload dev server (Vite `:5173`, Wails IPC `:34115`). |
| `task test` | Go unit (`-race`) + Vitest. |
| `task test-e2e` | Playwright e2e. Required for any UI feature (TDD rule below). |
| `task lint` | All linters (Go × both build tags, ESLint, Stylelint, shellcheck, Spectral, …). |
| `task fmt` | Go (`goimports-reviser` → `gofumpt`) + shell (`shfmt`). |
| `task gen-types` | Regenerate `frontend/src/api.gen.d.ts` after editing `api/openapi.yaml`. |
| `task cover` | Generate Go + frontend **unit** coverage reports (umbrella). Required before opening a PR. |
| `task cover-e2e` | **Integration** coverage from the Playwright suite (Go `-cover` + monocart V8 frontend) → `coverage/e2e/`. Informational, not gated. |

Full command catalog, env-var overrides, Dockerfile stages, package layout, and
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
  in-repo: `pkg/db/store.go` (`*SQLStore`), `pkg/db/dbtest/fake.go` (`*Fake`),
  `pkg/metrics/metrics.go` (`*Collector` vs `prometheus.Collector`). New
  implementations — including any leaf packages carved out of `pkg/app` — add the
  assertion in the same file as the type.

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

- **Package & directory size — cohesion over count.** Size a grouping by
  responsibility, not file count. **Go**: a package is *one* cohesive
  responsibility behind a small, intentional exported API. Many files in a
  package is idiomatic and good — keep file-per-concern; `pkg/db`, `pkg/parser`,
  and `pkg/cmd` are correctly single-responsibility packages with many files and
  must **not** be split to chase a number. Split a *package* only when it carries
  more than one reason to change (distinct sub-domains) **and** the extraction
  won't create an import cycle — typically by pulling pure logic into a leaf
  package the shell delegates to (`pkg/match`, `pkg/correlate`, `pkg/aggregate`,
  … carved out of the former `pkg/app` god-package; the `*App` shell keeps the
  wiring). **Vue/TS**: group by feature/domain, never one giant flat directory. A
  flat `components/` or `composables/` past ~20–25 files wants feature subfolders
  (`components/<feature>/`, `composables/<feature>/`, `shared/` for cross-feature
  pieces); colocate a feature's UI with its state, mirroring `components/widgets/`.
  Same best-effort spirit as File length — this is the direction of travel, not a
  gate; call out (don't silently grow) a grouping that sprawls across concerns.

- **McCabe cyclomatic complexity**: aspire to keep per-function complexity ≤ 10.
  Anything above 15 is a refactor candidate and should be called out in review.
  Reaching the ideal isn't always realistic — deeply nested parser logic or
  generated code may exceed it — but complexity should always be the direction
  of travel, never an afterthought.

- **TypeScript / Vue**: idiomatic TS — no `any`, narrow types at boundaries
  (`Pick<>` or permissive interfaces so callers aren't forced to satisfy fields
  the function never reads). Composition API; composables for stateful logic.
  Pure helpers in `frontend/src/match/match-helpers.ts`, never inside an SFC's
  `<script setup>`. Apply the same naming discipline as Go: component props,
  composable returns, and helper functions should read like documentation.
  Follow the [Vue 3 Style Guide](https://vuejs.org/style-guide/) for component
  conventions not covered explicitly here (naming, prop casing, SFC element
  ordering).

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

- **SRP / DIP — dependency-inject seams that make testing possible.** Production
  wires the real implementation; tests wire a fake. Examples in the codebase:
  the `db.Store` interface threaded into `*App` via `NewWithStore`; the
  `mountApp` helper's `vi.doMock('./api', …)` boundary for SFC tests.

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

**Test public interfaces, not internals.** Unit tests and e2e tests must exercise
exported functions, public handler surfaces, and user-visible behavior. Do not
write tests that reach into unexported helpers, assert on private struct fields,
or import internal packages from outside their own package. If the behavior of
an internal component matters, test it through the exported surface that
exercises it. Tests that are coupled to internal data structures are brittle,
resist refactoring, and should be rewritten or deleted.

**Coverage floor: 60% line coverage and 60% branch coverage**, measured by
`task cover`. This is a minimum, not a target — aim higher where the code is
consequential (parser logic, aggregation, error paths). PRs that regress either
metric without explicit justification should not merge.

**Exempt** (no TDD ceremony): typo fixes, doc-only edits, formatter/linter
passes, dependency bumps, configuration-only changes. Use judgement for
refactors — extracting a helper rarely needs a new test, but changing observable
behavior does.

**UI features need a failing Playwright e2e first.** Any feature that adds or
changes a user-visible affordance (button, filter, card state, modal, view)
starts with a RED `frontend/tests/e2e/*.spec.ts` driving it through a real
browser via `page.route()` mocks. Unit tests cover render branches and
composable contracts, but only the e2e proves the full transport chain
(api.ts ↔ /api/* ↔ Go handler ↔ Store ↔ aggregator ↔ Vue render). "Stitching a
known pattern across layers" is NOT an exemption — the match-deletion feature
shipped with a latent `r.json()`-on-204 bug because no e2e exercised the
POST → reload round-trip.

**Before declaring any task done**, run `task lint` and `task test`. If UI was
touched, also run `task test-e2e`. Never present work as complete while the
build is red or tests are failing — say what's broken and why instead.

### What to avoid

Speculative interfaces; abstract layers without a second concrete caller;
backwards-compat shims for unreleased code; "just in case" error handling for
impossible conditions; over-engineering for hypothetical future requirements;
tests that assert on unexported identifiers or internal data structures rather
than observable, public behavior.

## Cross-cutting conventions

- **New dependencies require approval.** Do not add new Go modules (`go get`)
  or npm packages without first proposing the dependency and getting explicit
  approval. Prefer the standard library and packages already in `go.mod` /
  `package.json`. When a new dep is genuinely the right call, name it and
  explain why before adding it.

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
| Prometheus metrics + Grafana | `.claude/rules/metrics.md` | `pkg/metrics/**`, `pkg/app/inference.go` |
| App shell | `.claude/rules/app-shell.md` | `pkg/app/**` |
| Frontend (Vue) | `frontend/CLAUDE.md` (nested; auto-loads when you read files in `frontend/`) | `frontend/**` |
| Accessibility | `.claude/rules/a11y.md` | `frontend/src/App.vue`, `frontend/src/components/**`, `frontend/src/styles/**`, `frontend/tests/**` |
| CI/CD workflows | `.claude/rules/ci-cd.md` | `.github/**` |
| Build / tooling / scripts | `.claude/rules/build-tooling.md` | `Taskfile.yml`, `mise.toml`, `Dockerfile*`, `scripts/**`, `lefthook.yml` |
| Documentation site | `.claude/rules/docs-site.md` | `docs/**`, `book/**`, root `*.md` |

Read on demand (never auto-loaded): **`docs/dev-reference.md`** — full make-target
catalog, env-var table, Dockerfile stages, package layout, helper scripts, test
fixtures.

> Auto memory is on by default (Claude Code ≥ v2.1.59). New debugging insights
> get recorded automatically — you don't need to hand-append "conventions" here
> anymore. Run `/memory` to review what's been saved.
