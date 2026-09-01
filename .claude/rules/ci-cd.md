---
paths:
  - ".github/**"
---

# CI/CD (`.github/workflows/`)

Eleven workflows:

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push to `main` or PR | **`lint`** (pure linters: golangci-lint ×4 tag/GOOS combos, ESLint, Stylelint, HTMLHint, ruff, shell, Spectral, typos, markdownlint, actionlint, action-pins + the bundle-size budget — thresholds in `scripts/ci/check-bundle-size.sh`, the source of truth — and the package/directory file budgets in `scripts/ci/package-size-budgets.txt`, asserted first in the job because it needs only git + awk). **`test-unit`** (split out 2026-07-10 so a failing test never reports as "lint"): Go `-race -short` + Vitest with JUnit → the "Unit test results" check, then `vue-tsc` + the `api.gen.d.ts` drift gate. **Security**: Trivy (SARIF → Security tab), govulncheck (both tags). gosec (Go SAST) is rolled into the `lint` job's golangci-lint (the `gosec` linter, both tags) — no separate gosec job/install. JS/TS SAST via CodeQL's `javascript-typescript`; Semgrep runs only locally via `task lint-semgrep` / `task verify`. **Complexity** is no longer a separate report-only job: it is ENFORCED inside the linters above — `gocyclo`/`gocognit`/`funlen` in `.golangci.yml` and ESLint's `complexity` rule — both at threshold 10, and both fail the build rather than printing. **Dead-code**: deadcode (`serveronly` only) + knip. **Coverage**: coverage-go (fails < `GO_COVERAGE_MIN`) + coverage-frontend (Vitest V8 against `coverage.thresholds`) — these are the UNIT artifacts. **PR comments**: sticky unit-test + coverage comment (`render-pr-report.py`); the coverage table shows Unit (vs-main Δ) **and** an Integration (e2e) column pulled cross-workflow from `e2e.yml`'s `go-e2e-coverage` / `frontend-e2e-coverage` artifacts (graceful "—" while that parallel run is still pending). **Drift**: schemathesis fuzzes a built server against `api/openapi.yaml`. |
| `codeql.yml` | Push/PR to `main` + weekly cron | CodeQL static analysis. Matrix covers `go`, `javascript-typescript`, and `actions`. Runs the **`security-and-quality`** suite — higher false-positive rate than default; triage every Security-tab alert. Languages without a security-and-quality pack (currently `actions`) silently fall back. Provides JS/TS SAST so no separate Semgrep CI job is needed. |
| `dependency-review.yml` | PR to `main` | Blocks PRs introducing vulnerable deps or disallowed licenses. |
| `pr-coverage-comment.yml` | `workflow_run` after CI + E2E complete | Renders the single sticky PR comment (unit-test results + Unit/Integration coverage table) via `scripts/ci/render-pr-report.py`. Fires on both workflows completing so the e2e column carries real numbers (artifacts downloaded cross-workflow, keyed on commit not branch). `workflow_run` runs the default-branch definition, so a change here only takes effect for PRs opened after it merges. |
| `e2e.yml` | Push/PR to `main` (paths: `frontend/**`, `pkg/**`, `**/*.go`, `api/openapi.yaml`, `e2e.yml`) | Playwright E2E. Builds the frontend (`E2E_COVERAGE=1` → inline source maps) + a coverage-instrumented serveronly binary (`go build -cover -coverpkg=./...`), `npx playwright install --with-deps chromium webkit`. `webServer` boots `/tmp/recall-e2e/recall-server` on `127.0.0.1:7099` with `HOME=/tmp/recall-e2e` (hermetic), stopped via `gracefulShutdown` SIGTERM so Go coverage counters flush. Also collects **integration coverage** (Go `-cover` via `GOCOVERDIR` + monocart V8 frontend coverage, Chromium only) — informational, never gates (collection is wrapped so it can't red a test): uploads `go-e2e-coverage` + `frontend-e2e-coverage` artifacts + a `$GITHUB_STEP_SUMMARY` table (`scripts/ci/e2e-coverage-summary.py`). Uploads `playwright-report/` on failure. Local equivalent: `task cover-e2e`. |
| `golden-corpus.yml` | dispatch + weekly | OCRs the full golden screenshot corpus against the pinned Tesseract and diffs against the baselined goldens. |
| `labels.yml` | Push to `main` (`.github/labels.yml`) + dispatch | Syncs repo labels via `EndBug/label-sync@v2`. `delete-other-labels: false` by default; dispatch input flips it `true`. |
| `pages.yml` | Push to `main` (paths: `api/openapi.yaml`, `docs/**`, `book/**`, `testdata/**`, `pages.yml`) + dispatch | Builds (1) Honkit user-docs book → Pages root; (2) Swagger UI → `/api/`. **One-time setup**: Settings → Pages → Source = "GitHub Actions". |
| `release-please.yml` | Push to `main` | Reads Conventional Commits, opens/updates a Release PR bumping manifest + CHANGELOG. Override version with `Release-As: X.Y.Z[-suffix]` footer. **Identity**: `GITHUB_TOKEN`, not a PAT — the anti-loop guard is worked around by `gh workflow run` instead. Consequence to remember when adding any Actions-authored PR: **a PR opened with `GITHUB_TOKEN` does NOT trigger `pull_request` workflows**, so it arrives with no CI (this is why `roster-watch.yml` runs the golden corpus itself). Bot-login exemptions need a branch-name fallback (`startsWith(head.ref, 'release-please--')`). |
| `roster-watch.yml` | Wed + Sat 08:23 UTC cron + dispatch | Runs `cmd/roster-watch` against Blizzard's hero page + patch notes and the upstream map list, and opens/updates a **draft** PR on the fixed branch `chore/roster-watch` with the entries it is confident in. Exit 2 (a source could not be read) **fails the job** — a scrape that quietly reports "in sync" goes quiet in exactly the week the answer stopped being true. When entries were written it runs the golden corpus IN THE JOB, because a PR authored by `GITHUB_TOKEN` gets no CI and that corpus is the only gate catching a roster-name collision. Never writes `seasons.yaml`, the guard tests, or the doc counts. Accepted differences live in `scripts/ci/roster-watch-accepted.txt`. Twice weekly because a measured year of patches falls into two clusters — Mon/Tue (22) and Wed/Thu/Fri (28) — which one weekly run can never sit after both of; Thursday alone left 20 of those 50 unseen for over five days. The cron comment carries the numbers and the sweep behind them. Local: `task roster-watch` (report-only). |
| `release.yml` | `v*` tags | Builds/publishes release artifacts. Details in RELEASES.md → "`release.yml` jobs". |

## Toolchain provisioning (hybrid, 2026-07-10)

- **Version truth**: Go = `go.mod` (`go 1.26.5`); Node = root `.node-version`
  (kept in sync with `mise.toml [tools] node` — `task check-deps` asserts it).
- **setup-go / setup-node jobs** (`go-version-file: go.mod`,
  `node-version-file: .node-version`, npm/module caches built in):
  `test-unit`, `coverage-go`, `coverage-frontend`, `govulncheck`,
  `complexity`, `dead-code`, `schemathesis`, and `e2e.yml`. Extra Go tools
  install via `go install …@latest` (go-junit-report, gocyclo, deadcode,
  task, gocover-cobertura); schemathesis via pipx with `SCHEMATHESIS_VERSION`
  greped from `mise.toml [env]` into `$GITHUB_ENV`.
- **mise-action stays** only where the poly-tool set demands it: the `lint`
  job (task/ruff/shfmt/shellcheck/golangci-lint built against the project Go)
  and the wails builds (`build-windows` + `release.yml` via the
  `wails-build-env` composite).
- **`concurrency` groups** on `ci.yml` / `e2e.yml` / `codeql.yml`: a re-push
  cancels the superseded PR run; main pushes and the CodeQL cron never cancel.

## Test stability conventions

- **Playwright retries: `process.env.CI ? 1 : 0`** — local stays zero-tolerance
  so flakes surface loudly in development; CI retries once because shared
  runners starve rAF/transition chains under load (five distinct single-test
  failures across four runs on one PR forced this). A retried test still
  reports as **flaky** in the run summary — visible, never silent. Convention:
  a "flaky" report in a green run = note the test; root-fix on its second
  appearance (the drag specs' hydration gates + the tour→modal handoff
  timeout are the precedents).
- **Skip allow-list** — every `t.Skip` in `pkg/` must appear in
  `scripts/ci/test-skips-allow.txt` with a one-line "why" comment.
  `scripts/ci/check-test-skips.sh` runs from both lefthook `pre-push.test-skips`
  and the CI `test-unit` job (as the "Inventory test skips" step) and fails
  on drift. The allow-list is for documented environment gates only — not for
  hiding flakes. No frontend test may use `.skip()` / `.only()` / `.fixme()`.
- **Pre-push is the FAST core only (~25s)** — `unit-go` (`-race -short`),
  `unit-frontend` (Vitest, no coverage), `gen-types-drift`, `test-skips`,
  `actionlint`+pins. Everything heavier (coverage gate, bundle budget,
  Playwright smoke, schemathesis, semgrep, complexity, deadcode/knip, the
  whole-project lint sweeps) moved to CI-only on 2026-07-10 and is bundled
  into **`task verify`** for an on-demand full local battery.

## Action-pinning & workflow conventions

- **Third-party GitHub Actions are SHA-pinned with a `# vX.Y.Z` comment** —
  `scripts/ci/check-action-pins.sh` enforces from `task lint-actions`, lefthook
  `pre-push.actionlint`, and CI. Tag-pinned refs rejected. Pattern:
  `uses: actions/checkout@<sha>  # v4` (two spaces before `#` for yamllint).
  First-party composite (`./.github/actions/foo`) exempt. Resolve a SHA:
  `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`.
- **CI jobs in `ci.yml` use sequential numbered comments** (`# ── Job N: ...`).
  When inserting a new job between existing ones, renumber subsequent comments to
  keep the sequence contiguous.
- **Any CI job that loads the root `main` package must first satisfy
  `//go:embed all:frontend/dist`.** On a fresh runner `frontend/dist/` is missing
  and `go build`/`go list`/`gosec` fails with `pattern all:frontend/dist: no
  matching files found`. Use `.github/actions/prepare-frontend-dist` with
  `real-assets: 'true'` (~30s Vite bundle — e2e, coverage, bundle-size) or
  `'false'` (stub — gosec, deadcode, CodeQL). Ad-hoc inline `mkdir -p
  frontend/dist` is forbidden.
- **`actions/setup-go@v6` sets `GOTOOLCHAIN=local`** which docker steps inherit,
  so any docker action with bundled Go older than `go.mod`'s `go 1.26.x` fails.
  Fix: install the tool via `go install ...@vX.Y.Z` to use setup-go's install
  (what the gosec job does). Don't switch to `GOTOOLCHAIN: auto` or skip setup-go.
- **Quote every hex color in `.github/labels.yml`.** YAML 1.1 parses unquoted
  `5319e7` as scientific notation, `008672` as octal losing leading zeros — both
  fail label-sync's `color should be a string`. Always `color: "008672"`.
- **Merge flow (2026-07-10)**: the 1-approving-review requirement was
  dropped (solo-maintainer repo) so **`gh pr merge --auto --rebase`** is the
  standard flow — GitHub merges the moment required checks pass; no monitor
  scripts, no `--admin`. Required checks still gate everything.
- **GitHub's "Code Quality" beta is intentionally disabled** — it ran a second
  CodeQL (go/js-ts/python, quality suite) on every PR, duplicating
  `codeql.yml`'s `security-and-quality` (a superset) and spamming autofix
  PRs (#620–624). Re-enable in Settings → Advanced Security if the AI
  findings are ever missed.
- **A failing workflow doesn't block merge until it's a required status check.**
  Adding a gate is a one-time UI flip — Settings → Branches → main → "Require
  status checks to pass" (same shape as enabling `pages.yml`). The inverse needs
  the flip too: when a required check's workflow is renamed or deleted, drop its
  stale context from the required list, or every PR blocks forever waiting on a
  status that never reports (merges then need `--admin`).
- **`gh workflow run --ref TAG` reads the workflow definition from that ref.** A
  `workflow_dispatch:` added later on `main` is invisible to tags cut before.
  `release.yml` has `workflow_dispatch:` from `v0.0.12-beta.0` onward. Procedure:
  RELEASES.md → "When `release.yml` doesn't auto-fire".
- **release-please / dependabot / web-UI-merge commit identity comes from the
  GitHub account's primary email**, not any repo file. Fix wrong bot-commit email
  at github.com → Settings → Emails.

## Build provenance & signing (release jobs)

- **Build provenance attestation** — `actions/attest-build-provenance@v2` needs
  `id-token: write` + `attestations: write` at the job. Attest binaries in build
  jobs AND sha256 files in the release job. Verify:
  `gh attestation verify <file> --repo sound-barrier/recall`. Does NOT replace
  Windows Authenticode.
- **cosign keyless image signing** — every GHCR tag from `publish-container` is
  signed via `cosign sign --yes "${tag%:*}@${DIGEST}"`. Sign by digest (not tag —
  re-point would silently break verification). Keyless OIDC: the Actions identity
  IS the signing identity (requires `id-token: write`). Complements
  build-provenance. Pin: `cosign-release: 'v2.4.1'`.

## Fixing CI on a remote-authored PR (Ultraplan / Claude Code on the web)

Those sessions skip lefthook, so commits routinely fail
`gofumpt`/`goimports-reviser`/`golangci-lint`/`typos`/`conventional`. Pattern:

- `lint` failure → checkout the branch, fix with `task lint` + `typos .`,
  commit `style:`/`docs:`, push.
- `typos` flags identifier+plural-s runs (pluralizing an all-caps word by
  appending `s` splits as `<word>` + `Ys`/`Ts`). Rephrase ("SUMMARY screens")
  rather than extending `_typos.toml`.
