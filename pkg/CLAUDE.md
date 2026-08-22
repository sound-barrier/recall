# Go (`pkg/`)

Auto-loaded when you work in `pkg/`. Cross-cutting rules — process, commits,
PRs, dependencies, the principles that hold in both languages — stay in the root
`CLAUDE.md`. The Vue/TypeScript half is `frontend/CLAUDE.md`. Domain detail for
particular packages lives in `.claude/rules/*.md` (database, api-design, parser,
app-shell), which load on their own globs and are complementary to this file:
this one is about the language, those are about the subject.

> The handful of Go files outside `pkg/` — `main.go`, `main_server.go`,
> `assets.go`, `cmd/bug-finder`, `cmd/seed-dev`, `spike/onnx` — are covered by a
> pointer rule scoped to `**/*.go`, because a nested file cannot reach them.

## The baseline, and where we depart from it

Two external guides are the default. Read them once; they are better than
anything we would write:

- [Effective Go](https://go.dev/doc/effective_go) — the language's own idiom.
- [Google's Go Style Guide](https://google.github.io/styleguide/go/) — and its
  companion [Style Decisions](https://google.github.io/styleguide/go/decisions)
  and [Best Practices](https://google.github.io/styleguide/go/best-practices).

**Where a guide and this file disagree, this file wins** — not because it is
better, but because it describes what CI here actually enforces, and a rule that
loses to a linter is a rule that wastes your afternoon. The rest of this file is
only the departures, the things we enforce mechanically, and the things this
codebase has gotten wrong before.

Known departures worth naming up front:

- **Google's guide discourages package-level state for tests.** This repo uses a
  package-level `var` swapped in tests as its seam in a few places (see *Test
  seams* in `.claude/rules/app-shell.md`). Deliberate, documented per site.
- **Doc comments on exported symbols are expected but not mandatory.** revive's
  `exported` rule is off, which also means its stutter check is off — so stutter
  is review-caught here, not lint-caught (see below).

## Code style

- **Accept interfaces, return structs.** Small interfaces (1–3 methods).
  Composition over inheritance. Embedding only for behavior delegation, never
  just to store a field. No premature abstraction — three similar lines beat one
  abstract one. **Do not introduce CGo dependencies**; the pure-Go build
  constraint is load-bearing for the release pipeline.

- **Interface compliance — assert it at compile time.** Every concrete type that
  is meant to satisfy an interface carries a static assertion next to its
  definition so a drifting method set breaks the build at the type, not at some
  distant call site (the k8s convention): `var _ Store = (*SQLStore)(nil)`. Use
  the form that matches the receiver — `(*T)(nil)` for pointer-receiver methods,
  `T{}` for value-receiver — never both (the wrong one won't compile). Canonical
  in-repo: `pkg/db/store.go` (`*SQLStore`), `pkg/db/dbtest/fake.go` (`*Fake`).
  New implementations — including any leaf package carved out of `pkg/app` —
  add the assertion in the same file as the type.

- **Prefer function-variable seams over interfaces for one-method dependencies**
  (duck typing in Go). When the seam has a single method and a single fake, an
  interface is YAGNI. Examples: `runTesseractFunc` / `parseSingleFunc` in
  `pkg/parser/`.

- **Liskov, concretely.** An implementation must honor the contract its callers
  rely on — `dbtest.Fake` passes the same Store contract suite as `*SQLStore`; a
  fake that cuts corners is a broken fake, not a shortcut.

- **`ls <dir>/*.go` is the source of truth** for file-per-concern packages — do
  not maintain literal file lists in any CLAUDE.md or rule.

## Package size

A package is *one* cohesive responsibility behind a small, intentional exported
API. Many files is idiomatic when they are one concern spelled file-per-file:
`pkg/db` is the canonical **correctly-large** package (schema, migration engine,
per-type CRUD — one responsibility, 30-odd files) and must **not** be split to
chase a number.

Every directory still answers to a file budget — read the numbers in
`scripts/ci/package-size-budgets.txt`, never from prose here. When one trips:

- **Split** when the grouping really carries more than one reason to change and
  the extraction won't create an import cycle. Pull pure logic into a leaf
  package the shell delegates to — `pkg/match`, `pkg/correlate`, `pkg/aggregate`
  were carved out of the former `pkg/app` god-package, and `pkg/coachreturn` out
  of `pkg/coach` when one package turned out to hold both a coach's desk and a
  player's inbox.
- **Bump** when the new file is the same responsibility spelled one concern
  wider (a new migration, a new screenshot type, a new endpoint on an existing
  surface): raise the number, rewrite the WHY above the entry, append a row to
  `package-size-budget-history.md`.

Splitting is cheaper in Vue/TS than in Go — a folder has no API boundary and no
import-cycle risk — which is why the frontend budgets sit below the Go ones.

## Go-specific smells

- `any` as a shortcut → a concrete type or a small (1–3 method) interface;
  legitimate only at true marshal/variadic boundaries (`writeJSON`,
  `emitEvent`). `gocritic` flags a range of Go micro-smells (**lint**).
- *Interface pollution* — an interface with one implementation, or defined on
  the producer side → declare it at the *consumer*, only once a second impl
  or a fake earns it; a one-method seam is a func var, not an interface.
- *Ignored error* — dropping a real error → handle or return it. errcheck
  catches the bare unassigned call (**lint**); the blank-assign `_ = f()` form
  passes lint (check-blank is off because this codebase uses it as the
  deliberate-drop idiom) — so a blank assign IS the claim "dropping this is
  safe", and review holds it to that.
- *Sentinel zero-value as "no result"* — `""`/`0`/`nil` meaning absence → a
  typed result or an explicit error. Recent in-repo example: a status validator
  that asked "is this valid?" by asking "does defaulting change it?"
  (`statusOrDefault(status, "") == ""`).
- *Naked return* in more than a couple of lines → explicit values (**lint**
  nakedret).
- *Stutter* — `match.MatchRecord`, `db.DBHealth` → drop the package prefix:
  `match.Record`, `db.Health`. Review-caught, NOT lint-caught here (see
  *departures* above).
- *Long parameter list* — same-typed parameters sitting adjacent are the
  dangerous shape, because transposing two of them compiles. `review.MomentRef`
  exists because `(reviewID, matchKey, momentID string)` did not.
- *Premature goroutines/channels* — concurrency with no measured need →
  simple synchronous code first.

## Tests

**Black-box only.** Go tests declare `package <pkg>_test` (the external test
package), so only exported identifiers are even reachable; unexported access
goes through one `export_test.go` shim per package that re-exports what the
external tests need. Exemplars: `pkg/cmd/export_test.go`,
`pkg/parser/export_test.go`.

If something seems untestable black-box, that is a design smell — fix the API,
don't white-box the test.

**Fixtures belong to the package that needs them.** When a package is carved
out, resist copying the parent's seeded corpus across "just to get green". Ask
what the new package actually reasons about: `pkg/coachreturn` asks only whether
a match key is in the player's history, so its fixture seeds keys rather than
five tables of realistic screenshot rows.

**Coverage floor** is `GO_COVERAGE_MIN` in `Taskfile.yml`. Read it there.

## Gates this code answers to

`task lint-go` runs golangci-lint across **four** tag/GOOS combinations
(default and `serveronly`, each for the host and `GOOS=windows`), so a new
package must compile under all four. `gci` owns import grouping — run
`task fmt-go` before committing or lint fails on formatting alone.

Also: `task test-go`, `task cover-go`, `task dead-code-go` (allow-list at
`scripts/ci/deadcode-allow.txt`), `task check-package-size`, and
`task check-api-drift` when anything that serializes to the wire moves.

## A tripwire worth knowing

**A frontend test file reads Go testdata by relative path.**
`pkg/match/testdata/replay_code_cases.json` pins the replay-code format and is
read by `frontend/src/match/replay-code.test.ts`. Moving the fixture, or
`pkg/match/replay_code.go` beside it, breaks Vitest with a file-not-found and
**no Go gate will warn you**.

It is worth the coupling. A match key is minted from a replay code, so if Go
and TypeScript disagree about a single character, a coach's note lands on a
key that does not exist on the player's machine and nothing anywhere reports
an error. That is why neither side uses its own language's `trim` or
`toUpperCase` — Go's are Unicode-aware and JavaScript's are Unicode-aware
differently, in both directions. Spell character sets out in ASCII when two
implementations of one rule have to agree.

The note grammar used to be a second such pair (`pkg/coach/markdown.go` and
its TypeScript twin, pinned by `markdown_cases.json`). When the coach's
exported page moved to the frontend — to where the app's real stylesheets
are — the Go renderer lost its only caller, and keeping it would have meant
ten allow-list entries for a file nobody called. Both it and the fixture now
live in `frontend/src/match/markdown/`.
