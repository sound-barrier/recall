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

| Command | Purpose |
|---|---|
| `make dev` | Hot-reload dev server (Vite `:5173`, Wails IPC `:34115`). |
| `make test` | Go unit (`-race`) + Vitest. |
| `make test-e2e` | Playwright e2e. Required for any UI feature (TDD rule below). |
| `make lint` | All linters (Go × both build tags, ESLint, Stylelint, shellcheck, Spectral, …). |
| `make fmt` | Go (`goimports-reviser` → `gofumpt`) + shell (`shfmt`). |
| `make gen-types` | Regenerate `frontend/src/api.gen.d.ts` after editing `api/openapi.yaml`. |

Full command catalog, env-var overrides, Dockerfile stages, package layout, and
helper-script reference: **`docs/dev-reference.md`**.

## Working style

Prescriptive defaults for how new code should be written and how changes should
be made. Override only when the user explicitly asks for something different.

### Code style

- **Go**: follow [Effective Go](https://go.dev/doc/effective_go). Accept
  interfaces, return structs. Small interfaces (1–3 methods). Composition over
  inheritance. Embedding only for behavior delegation, never just to store a
  field. No premature abstraction — three similar lines beat one abstract one.
- **TypeScript / Vue**: idiomatic TS — no `any`, narrow types at boundaries
  (`Pick<>` or permissive interfaces so callers aren't forced to satisfy fields
  the function never reads). Composition API; composables for stateful logic.
  Pure helpers in `frontend/src/match-helpers.ts`, never inside an SFC's
  `<script setup>`.
- **Comments**: default to none. Only when the WHY is non-obvious — a hidden
  constraint, a surprising invariant, a workaround for a specific bug. Never
  re-explain WHAT the code does; well-named identifiers already do that.

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

### What to avoid

Speculative interfaces; abstract layers without a second concrete caller;
backwards-compat shims for unreleased code; "just in case" error handling for
impossible conditions; over-engineering for hypothetical future requirements.

## Cross-cutting conventions

- **Use `tmp/` under the repo root for ad-hoc scratch files — never `/tmp/...`
  or any path outside the repo root.** PR-body drafts, intermediate `jq` output,
  scratch scripts, log dumps — use `tmp/foo.md` (gitignored). **Carve-out**:
  existing infra paths (`/tmp/recall-e2e/...`, `HOME=/tmp/recall-smoke`,
  `/private/tmp/...` for the macOS Tesseract symlink) are baked into
  Makefile/CI/scripts and stay as-is — but don't add new ad-hoc `/tmp` paths.

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
| Build / tooling / scripts | `.claude/rules/build-tooling.md` | `Makefile`, `Dockerfile*`, `scripts/**`, `tool-versions.env`, `lefthook.yml` |
| Documentation site | `.claude/rules/docs-site.md` | `docs/**`, `book/**`, root `*.md` |

Read on demand (never auto-loaded): **`docs/dev-reference.md`** — full make-target
catalog, env-var table, Dockerfile stages, package layout, helper scripts, test
fixtures.

> Auto memory is on by default (Claude Code ≥ v2.1.59). New debugging insights
> get recorded automatically — you don't need to hand-append "conventions" here
> anymore. Run `/memory` to review what's been saved.
