---
paths:
  - ".github/**"
---

# CI/CD (`.github/workflows/`)

Twelve workflows. Every one starts from `permissions: {}` or `contents: read`
and grants write scopes per job; every checkout sets `persist-credentials:
false` except `release-please.yml`'s `tag-and-dispatch`, which pushes a tag.

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push to `main` or PR | Thirteen jobs, detailed in the next section. **`ci-gate`** is the only one branch protection is meant to require (see "Required checks & merge flow"). |
| `e2e.yml` | Push to `main` + every PR (no `paths:` filter) | One job, **`playwright`**, required on its own (not under `ci-gate`, so it keeps its own runs and badge). A detect step pipes `git diff --no-renames --name-only` into `scripts/ci/e2e-relevant-changes.sh`, which **fails closed**: the suite is skipped (and the job posts success) only when EVERY changed path is on its safe list (docs, `.claude/`, top-level markdown, GitHub metadata, the release-please manifest); any other path, an empty list or a failed diff runs it. Builds the frontend (`E2E_COVERAGE=1` → inline source maps) + a coverage-instrumented serveronly binary (`go build -cover -coverpkg=./...`), `npx playwright install --with-deps chromium webkit`. `webServer` boots `/tmp/recall-e2e/recall-server` on `127.0.0.1:7099` with `HOME=/tmp/recall-e2e` (hermetic), stopped via `gracefulShutdown` SIGTERM so Go coverage counters flush. **Integration coverage** (Go `GOCOVERDIR` + monocart V8, Chromium only) is informational and can't red a test: `go-e2e-coverage` + `frontend-e2e-coverage` artifacts and a `$GITHUB_STEP_SUMMARY` table (`scripts/ci/e2e-coverage-summary.py`). Uploads `playwright-report/` on failure. Local: `task test-e2e`, `task cover-e2e`. |
| `codeql.yml` | Push/PR to `main` + weekly cron | CodeQL, matrix `go` (manual build), `javascript-typescript`, `actions` → the required **`Analyze (<language>)`** checks. Runs the **`security-and-quality`** suite — higher false-positive rate than default; triage every Security-tab alert. Languages without a security-and-quality pack (currently `actions`) silently fall back. Provides JS/TS SAST, so Semgrep runs only locally (`task lint-semgrep`). |
| `dependency-review.yml` | PR to `main` | Required **`dependency-review`**. `fail-on-severity: high` with `fail-on-scopes: runtime, development, unknown`: dev deps are not test-only here (Vite and its plugins build the bundle embedded in the exe). Judges only the dependencies a PR adds. No license policy. |
| `pr-coverage-comment.yml` | `workflow_run` after CI + E2E complete | One sticky PR comment (unit-test results + a Unit/Integration coverage table) via `scripts/ci/render-pr-report.py`, artifacts pulled cross-workflow by commit. Skips fork runs (it holds `pull-requests: write`). `workflow_run` always runs the DEFAULT-branch definition, so an edit here takes effect once merged, for every run that completes afterwards — a PR cannot test its own change to this file. |
| `golden-corpus.yml` | Daily 09:17 UTC + dispatch + push/PR touching `pkg/parser/**`, `testdata/**` or the workflow | OCRs the full golden screenshot corpus (submodule `testdata/images`) against the pinned Tesseract (`scripts/ci/install-tesseract.sh`) and diffs against the baselined goldens. No `-race`. |
| `labels.yml` | Push to `main` (`.github/labels.yml`) + dispatch | Syncs repo labels via `EndBug/label-sync`. `delete-other-labels: false` by default; the dispatch input flips it. |
| `pages.yml` | Push to `main` (paths: `api/openapi.yaml`, `docs/**`, `book/**`, `testdata/**`, the six `pkg/parser/*.yaml` data files, `tools/package*.json`, the workflow) + dispatch | Two jobs: **`build`** (`contents: read`, mise without cache, `npm ci --prefix tools`, Honkit) uploads the `pages-book` artifact; **`deploy`** (`pages: write`, `id-token: write`, `github-pages` environment, no mise/npm/third-party code) stages `api/` and the reference-data channel from its own checkout and publishes. Details in `.claude/rules/docs-site.md`. **One-time setup**: Settings → Pages → Source = "GitHub Actions". |
| `release-please.yml` | Push to `main` | Two jobs. **`release-please`** (`contents: write`, `pull-requests: write`) runs the third-party action that opens/updates the Release PR. **`tag-and-dispatch`** (`contents: write`, `actions: write`, `pull-requests: write`; first-party checkout + repo code only) runs only when the pushed commit's subject starts with `chore(main): release`: `scripts/release/push-release-tag.sh` requires HEAD == `GITHUB_SHA`, refuses a squatted tag, runs `scripts/release/verify-release-ref.sh`, requires the merged PR to be `release-please--branches--main` by `github-actions[bot]`, then pushes the tag and `gh workflow run release.yml --ref vX.Y.Z` (a `GITHUB_TOKEN` tag push fires no `push: tags` trigger). Override a version with a `Release-As: X.Y.Z[-suffix]` footer. **A PR opened with `GITHUB_TOKEN` triggers no `pull_request` workflows**, so it arrives with no CI (why `roster-watch.yml` runs the golden corpus itself). |
| `release.yml` | `v*` tags + `workflow_dispatch` (the normal path) | Five jobs: `verify-ref` → `build-windows` → `sbom` → `sign-attest` (the only job in the `release` environment) → `release`. See "Build provenance & signing" below and RELEASES.md → "`release.yml` jobs". |
| `roster-watch.yml` | Wed + Sat 08:23 UTC cron + dispatch | Two jobs, so the token that can push never meets the code that reads the web. **`watch`** (`contents: read`) runs `cmd/roster-watch` against Blizzard's hero page + patch notes and the upstream map list, runs the golden corpus when entries were written, and uploads the YAML edits as a patch. **`propose`** (`contents: write`, `pull-requests: write`, no downloaded toolchain) applies the patch only if it touches nothing but existing `pkg/parser/*.yaml` files (patch check, `git apply --include`, then a porcelain check), and only its push step runs `gh auth setup-git` before `scripts/ci/roster-watch-pr.sh` updates the **draft** PR on `chore/roster-watch`. Exit 2 (a source could not be read) fails the run. Never writes `seasons.yaml`, the guard tests or the doc counts. Accepted differences: `scripts/ci/roster-watch-accepted.txt`. Twice weekly because a measured year of patches clusters Mon/Tue and Wed–Fri; the cron comment has the numbers. Local: `task roster-watch` (report-only). |
| `scorecard.yml` | Push to `main`, weekly cron, `branch_protection_rule`, dispatch | OpenSSF Scorecard with `publish_results: true` (the README score badge). `api.scorecard.dev` verifies this file before accepting a result, so the job keeps `uses:`-only steps, no workflow-level env or write scopes, and `id-token: write` in that job alone. `file_mode: git`, because `.gitattributes` export-ignores `.github/`. The SARIF is a 5-day artifact and is NOT uploaded to code scanning. Refuses non-PR events off the default branch, so never dispatch it on a branch. |

## `ci.yml` jobs

- **`lint`** — setup-mise (below), then, cheapest first: package-size budgets
  (`scripts/ci/check-package-size.sh`), `scripts/ci/check-tool-pins.sh`,
  `task check-go-mod-tidy` (`go mod tidy -diff`; the release build runs tidy
  itself, so drift must fail review), zizmor **online** (`GH_TOKEN` enables
  impostor-commit, known-vulnerable-actions and ref-version-mismatch), then the
  real Vite build, the bundle-size budget (`scripts/ci/check-bundle-size.sh`, the
  threshold source of truth), CSS theme + token checks, golangci-lint ×4
  (default/serveronly × linux/windows GOOS, `gosec` included), ESLint,
  dependency-cruiser, jscpd, Stylelint, HTMLHint, ruff, shellcheck + shfmt, the
  release-script smoke suite (`task smoke-release-scripts`; needs
  `fetch-depth: 0`), `task tools-install` as its own step, Spectral, taplo,
  sqlfluff, Biome, typos, markdownlint, `task check-test-exports`,
  `scripts/ci/check-doc-paths.sh`, actionlint, `scripts/ci/check-action-pins.sh`
  and `scripts/ci/check-ci-gate-needs.sh`. **Complexity is enforced inside the
  linters** (`gocyclo`/`gocognit`/`funlen` and ESLint `complexity`, threshold
  10), not by a job.
- **`test-unit`** (`contents: read`, `checks: write`) — Go `-race -short` +
  Vitest with JUnit → the "Unit test results" check (informational; the job
  ends with an `.outcome` gate so a test failure reds the job itself), the
  test-skip inventory (`scripts/ci/check-test-skips.sh`), `vue-tsc`, and the
  generated-client drift gate.
- **`build-windows`** — the native Wails cross-compile + `makensis`, through
  `wails-build-env` (shared mise cache allowed here; release.yml turns it off).
- **`trivy`** (`security-events: write`) — HIGH/CRITICAL gate + SARIF upload
  (`limit-severities-for-sarif: true`). Same as `task trivy`.
- **`govulncheck`** — both build tags, via `scripts/ci/govulncheck-retry.sh`
  (retries only a transient vuln DB fetch).
- **`secrets`** — `task secrets`: gitleaks over every commit reachable from
  HEAD, config `.gitleaks.toml`. lefthook's pre-commit hook scans the staged
  diff.
- **`dead-code`** — deadcode (serveronly, `scripts/ci/deadcode-check.sh`) + knip.
- **`coverage-frontend`**, **`coverage-go`** — the UNIT coverage gates
  (`coverage.thresholds` in `vitest.config.ts`; `GO_COVERAGE_MIN` via
  `task cover-go`).
- **`schemathesis`** — fuzzes a built serveronly binary against
  `api/openapi.yaml` (`scripts/ci/check-api-drift.sh`); schemathesis and
  `jsonschema-rs` install via pipx at the `mise.toml [env]` versions.
- **`commit-lint`** (PRs only; skipped on push) —
  `scripts/ci/check-commit-subjects.sh` over `merge-base..head`, `--no-merges`,
  the same script lefthook's `commit-msg` hook runs. No exemptions for bots.
- **`branch-coverage`** — gobco condition coverage, **report-only**
  (`continue-on-error`) and deliberately NOT under `ci-gate`.
- **`ci-gate`** (`if: always()`, `permissions: {}`) — `needs` every job above
  except `branch-coverage`, and fails on any result other than `success` or
  `skipped`. **Add every new `ci.yml` job to `ci-gate`'s `needs`** (never to
  branch protection); `scripts/ci/check-ci-gate-needs.sh` fails `lint` when one
  is missing. A job given an `if:` that is false on PRs passes the gate
  unrun, exactly as `commit-lint` does on push.

## Required checks & merge flow

- **Branch protection on `main` is meant to require eight checks**, with
  `strict: true` and `enforce_admins: true` (both already on): `ci-gate`,
  `playwright`, `dependency-review`, `Analyze (go)`,
  `Analyze (javascript-typescript)` and `Analyze (actions)` (app 15368,
  GitHub Actions), plus `CodeQL` and `Trivy` (app 57789, code scanning).
  Until the maintainer swaps the older per-job list (`lint`, `test-unit`,
  `trivy`, `schemathesis`, "Unit test results" and the rest) for these, which
  waits on `ci-gate` running green on `main`, that older list is what gates
  merges. Never reason from either list without checking what is live:
  `gh api repos/sound-barrier/recall/branches/main/protection --jq '.required_status_checks.checks'`.
- **Once that swap is live, a new `ci.yml` job gates merges through
  `ci-gate`** with no settings change. A new WORKFLOW (outside `ci.yml`)
  gates nothing until the maintainer adds its context. The inverse bites
  harder: renaming a required job or workflow context leaves every PR waiting
  on a status that never reports, and `--admin` cannot get past it.
- **Merge with `gh pr merge --auto --rebase`**, armed before `main` moves.
  `--admin` is refused (`enforce_admins`), and `strict` auto-updates a stale
  branch, which resets every passing check. `main` takes no direct push, and
  GitHub's Rebase and merge drops a commit that was empty to begin with.
- **GitHub's "Code Quality" beta is intentionally disabled** — it duplicated
  `codeql.yml`'s `security-and-quality` suite and spammed autofix PRs
  (#620–624). Re-enable in Settings → Advanced Security if the AI findings are
  ever missed.

## Toolchain provisioning

- **Version truth**: Go = `go.mod` (`go 1.27.1`); Node = root `.node-version`,
  equal to `mise.toml [tools] node` (`scripts/ci/check-tool-pins.sh` asserts
  it).
- **`.github/actions/setup-mise` is the only `jdx/mise-action` call.** It pins
  the mise `version` and the raw linux-x64 binary's `sha256`, installs the
  requested `install_args` with `--locked` from the committed `mise.lock`, and
  loads `mise.toml [env]` into `$GITHUB_ENV`. Inputs: `cache: 'false'` for a job
  whose output must not depend on a cache another run saved (release.yml's
  `build-windows`, `pages.yml`'s `build`), and `github_token: ''` where the tools
  need no GitHub API. Users: ci.yml `lint` and `secrets`, `golden-corpus.yml`,
  `pages.yml` `build`, `roster-watch.yml` `watch`, and the `wails-build-env`
  composite (ci.yml and release.yml `build-windows`). x64 Linux runners only.
- **A mise bump moves five values in one commit**: setup-mise's `version` and
  `sha256`, `mise.toml` `min_version`, `scripts/install-mise.sh` `MISE_VERSION`
  (with its two Linux hashes), and `mise.lock` regenerated with that exact
  binary. Procedure: `.claude/rules/build-tooling.md`.
- **setup-go / setup-node jobs** (`go-version-file: go.mod`,
  `node-version-file: .node-version`): `test-unit`, `govulncheck`, `dead-code`,
  `coverage-frontend`, `coverage-go`, `schemathesis`, `branch-coverage`,
  `e2e.yml`, CodeQL's Go leg, and release.yml's `sign-attest` (`cache: false`).
  Their Go tools install as `go install <module>@vX.Y.Z  # = mise.toml [tools]`
  with the literal version, never `@latest`; check-tool-pins holds each literal
  to its pin.
- **The npm CLIs** (Biome, Spectral, Honkit, markdownlint-cli2) install from
  `tools/package-lock.json` (`task tools-install`; `pages.yml` runs
  `npm ci --prefix tools` itself), behind `tools/.npmrc`'s 7-day
  `min-release-age`.
- **`concurrency`**: ci.yml / e2e.yml / codeql.yml cancel a superseded PR run
  but never a main push or the cron; `pages` and `roster-watch` run one at a
  time; release.yml serializes per tag without canceling.

## Action pinning & workflow conventions

- **Third-party actions are SHA-pinned with an exact `# vX.Y.Z` comment** —
  `scripts/ci/check-action-pins.sh` enforces it from `task lint-actions`,
  lefthook `pre-push.actionlint` and CI; online zizmor's ref-version-mismatch
  catches a comment that names a different commit. Pattern:
  `uses: actions/checkout@<sha>  # v7.0.1` (two spaces before `#` for
  yamllint). First-party composites (`./.github/actions/foo`) are exempt.
  Resolve a SHA: `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`.
- **Allowed actions are meant to be an allowlist in two places.**
  `.github/zizmor.yml`'s `forbidden-uses` is the list the repository's
  allowed-actions setting is to mirror (GitHub-owned + named owners, with SHA
  pinning required). The maintainer owns that setting, and until it is
  applied it allows every action (`allowed_actions: all`,
  `sha_pinning_required: false`);
  `gh api repos/sound-barrier/recall/actions/permissions` shows what is live.
  A new third-party action needs an entry in `.github/zizmor.yml` in the same
  PR AND, once the setting is applied, the maintainer's settings change before
  it merges. `self-repository` stays disabled there because actionlint
  rejects `$/`. Inline zizmor ignores sit on the `name:` or trigger line,
  never after a `uses:` pin (that hides the version comment).
- **zizmor runs twice**: lefthook pre-commit with `--offline`, CI's `lint` job
  online. `task lint-actions` picks online when `GH_TOKEN`/`GITHUB_TOKEN` is set.
- **CI jobs in `ci.yml` use sequential numbered comments** (`# ── Job N: ...`).
  Renumber the rest when inserting a job, and add it to `ci-gate`.
- **Any CI job that loads the root `main` package must first satisfy
  `//go:embed all:frontend/dist`.** Use `.github/actions/prepare-frontend-dist`
  with `real-assets: 'true'` (~30s Vite bundle — `lint`, coverage-go,
  schemathesis) or the default `'false'` stub (`test-unit`, CodeQL). Ad-hoc
  inline `mkdir -p frontend/dist` is forbidden.
- **`actions/setup-go` (v7) sets `GOTOOLCHAIN=local`**, which docker steps
  inherit, so a docker action with bundled Go older than `go.mod` fails.
  Install the tool with `go install ...@vX.Y.Z` under setup-go instead; don't
  switch to `GOTOOLCHAIN: auto` or skip setup-go.
- **Quote every hex color in `.github/labels.yml`.** YAML 1.1 parses unquoted
  `5319e7` as scientific notation and `008672` as octal — both fail
  label-sync's `color should be a string`. Always `color: "008672"`.
- **`gh workflow run --ref TAG` reads the workflow definition from that ref.** A
  `workflow_dispatch:` added later on `main` is invisible to tags cut before.
  `release.yml` has `workflow_dispatch:` from `v0.0.12-beta.0` onward. Procedure:
  RELEASES.md → "When `release.yml` doesn't auto-fire".
- **release-please / dependabot / web-UI-merge commit identity comes from the
  GitHub account's primary email**, not any repo file. Fix a wrong bot-commit
  email at github.com → Settings → Emails.

## Dependabot (`.github/dependabot.yml`)

- **One flat 7-day cooldown** (`cooldown: default-days: 7`) on every entry,
  patch and minor alike — the same week-long age gate as CLAUDE.md's. Cooldown
  applies to version updates only; security updates are not held.
- **Entries**: `gomod` `/`, `npm` `/frontend`, `npm` `/tools` (its own
  `tools-deps` groups), `github-actions` `/` (workflow pins, the auto-merged
  `actions` group), and `github-actions` `/.github/actions/*` for the composite
  actions. Every ecosystem sends majors in their own `*-major` group.
- **Composite-action bumps are HAND-MERGED.** They change what builds a release
  (setup-mise wraps `jdx/mise-action`), so they arrive as `actions-composite*`
  PRs labeled `release-toolchain`; read the upstream diff and merge them
  yourself, never through auto-merge.

## Build provenance & signing (`release.yml`)

- **The build cannot publish or attest.** `build-windows` and `sbom` hold
  `contents: read` only; `build-windows` provisions through `wails-build-env`
  with `cache: 'false'`, so no cache a main-branch run saved can feed the
  shipped binary.
- **Every hand-off is bound to a digest.** Each producing job records its files'
  SHA-256 as a job output, and every consumer runs
  `scripts/release/verify-asset-digests.sh` (bytes, plus the exact file names
  in `sign-attest`) before it touches a downloaded artifact.
- **`sign-attest` is the only job in the `release` environment**: a maintainer
  approves it in the UI, one approval per run (see RELEASES.md → "Approving a
  release"; Claude never approves). It alone holds `id-token: write` +
  `attestations: write` and can read `RECALL_UPDATE_SIGNING_KEY`, runs only
  first-party actions and repo code, builds `cmd/update-signing` with
  `GOTOOLCHAIN=local GOPROXY=off GOFLAGS=-mod=readonly`, keeps the key in ONE
  step's env, verifies the `.sig` files in a separate step, writes `SHA256SUMS` +
  per-file `.sha256`, makes ONE `actions/attest-build-provenance` attestation
  over the exes, `.sig`, YAMLs, `.bat`, SBOM and checksums, copies its bundle
  to `recall-X.Y.Z.intoto.jsonl`, and runs
  `scripts/release/check-release-assets.sh`.
- **`release`** holds `contents: write` only and publishes exactly the verified
  `release-assets/` directory in one `softprops/action-gh-release` call. A
  prerelease stays a draft, because releases are immutable.
- **Verify** a published asset with
  `gh attestation verify <file> --repo sound-barrier/recall --signer-workflow sound-barrier/recall/.github/workflows/release.yml --source-ref refs/tags/vX.Y.Z`
  (add `--bundle recall-X.Y.Z.intoto.jsonl` to skip the attestations API; it
  still fetches Sigstore's trusted root), and the signature with
  `task update-signing -- verify <absolute path>`. None of this replaces Windows
  Authenticode: the installer carries none.

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
- **Pre-push is the FAST core only** — `actionlint` (+ action pins),
  `unit-go` (`-race -short`), `unit-frontend` (Vitest, no coverage),
  `gen-types-drift`, `test-skips`, `package-size` and `package-size-history`.
  Everything heavier (coverage gate, bundle budget, Playwright smoke,
  schemathesis, semgrep, deadcode/knip, the whole-project lint sweeps) is
  CI-only and bundled into **`task verify`** for an on-demand full local
  battery.

## Fixing CI on a remote-authored PR (Ultraplan / Claude Code on the web)

Those sessions skip lefthook, so commits routinely fail `golangci-lint fmt`
(gci import groups + gofmt), `golangci-lint`, `typos` or `commit-lint`.
Pattern:

- `lint` failure → check out the branch, fix with `task lint` + `typos .`,
  commit `style:`/`docs:`, push.
- `commit-lint` failure → it reads EVERY commit the PR adds, so a fixing commit
  on top does not help: reword the offending subjects and force-push the
  branch.
- `typos` flags identifier+plural-s runs (pluralizing an all-caps word by
  appending `s` splits as `<word>` + `Ys`/`Ts`). Rephrase ("SUMMARY screens")
  rather than extending `_typos.toml`.
