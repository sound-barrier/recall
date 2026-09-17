---
paths:
  - "Taskfile.yml"
  - "mise.toml"
  - "build/**"
  - "scripts/**"
  - "lefthook.yml"
  - "initialize.sh"
  - ".devcontainer/**"
  - "tools/**"
---

# Build & tooling conventions

## Pinned tool versions

Live in `mise.toml` — `[tools]` for anything mise installs, `[env]` for the
versions the tasks and CI read themselves (`TYPOS_VERSION`, `SEMGREP_VERSION`,
`SCHEMATHESIS_VERSION`, `JSONSCHEMA_RS_VERSION`, `GOBCO_VERSION`,
`RUFF_VERSION`, `SQLFLUFF_VERSION`, and `TESSERACT_VERSION` — that last one
informational major.minor, so a mismatch means re-baseline
`testdata/*.golden.json` and bump; `.devcontainer/postCreate.sh` compares the
container's apt Tesseract against it and warns). The npm CLIs are the
exception, pinned in `tools/` (below).

Consumers no longer read a file; they read the environment mise puts them in:

- **Locally** — `mise activate` exports `[env]`, so `Taskfile.yml`
  references `$SEMGREP_VERSION` and friends directly.
- **CI** — `.github/actions/setup-mise` (the repo's only `jdx/mise-action` call)
  loads `mise.toml [env]` into `$GITHUB_ENV` for every job regardless of
  `install_args`. That is also why `DEFAULT_MAX_FILES` must never be added to
  `[env]`: it would silently override the package-size gate.

**`mise.lock` is committed, and CI installs from it with `--locked`.** Every
`[tools]` entry is an exact release; the lock adds each core/aqua tool's URL and
checksum for the four `lockfile_platforms` (go:/pipx: entries are version-only).
mise-action adds `--locked` on its own whenever a lock exists, so a tool with no
lock entry, or no URL for the runner's platform, fails the job. The rules:

- **Bump tools with `task update-mise`** (`mise upgrade --bump --local`, which
  `minimum_release_age = "7d"` holds to week-old releases, then `mise lock`).
  It excludes go, golangci-lint, gobco and wails3: each moves only as its own
  change (go.mod, a lint sweep, a coverage re-baseline, the wails lockstep).
  Commit `mise.toml` and `mise.lock` together, and sync `.node-version`.
- **taplo's checksums are hand-hashed.** Upstream publishes none, so `mise lock`
  writes its entries URL-only; `mise lock` keeps the added SHA-256 lines, a
  taplo bump drops them, and `task update-mise` fails until they are back.
- **The mise version is one value in four places**: `version` + `sha256`
  (raw `linux-x64` binary) in `.github/actions/setup-mise/action.yml`,
  `MISE_VERSION` + both Linux hashes in `scripts/install-mise.sh` (the
  devcontainer and Debian bootstrap, replacing `curl mise.run | sh`),
  `min_version` in `mise.toml`, and the mise that wrote `mise.lock`. mise
  2026.9.3–2026.9.6 read only lockfile version 1 and newer mise writes version 2
  for a new lock, so regenerate the lock with the exact pinned binary
  (downloaded and checksum-verified), never a newer local mise, and never run
  `mise lock --upgrade` with a different binary.
- **CI's setup-go jobs bypass mise for their Go tools** (go-junit-report,
  govulncheck, deadcode, task, gocover-cobertura, gobco) to keep setup-go's Go
  build cache, so each `go install <module>@vX.Y.Z` in `ci.yml` and `e2e.yml`
  names the `[tools]` pin literally. A bump edits both.
- **`pipx.uvx = false` is load-bearing.** With uv on PATH, newer mise records uv
  dependency graphs for pipx tools that uv-less CI runners cannot replay under
  `--locked`.
- **`scripts/ci/check-tool-pins.sh` enforces these rules and the `tools/` ones
  below** (`task check-tool-pins`, in `task lint` and CI's lint job): exact
  `[tools]` and `[env]` `*_VERSION` values, `mise.lock` agreeing with them and
  uncommitted changes absent, `.node-version`, the `go install` literals,
  `jdx/mise-action` only in `setup-mise` with one mise version and hash across
  the four places, no `@latest` or on-demand package fetch
  (`npx <pkg>@<version>`, `npx --yes`, `pnpm dlx`, `uvx`, …) anywhere a tool is
  installed, and exact `tools/` pins. npx assumes `--yes` in CI, so a bare
  `npx <name>` is fine only where a committed lockfile installs `<name>`. It
  fails with an annotation naming the line; fix the pin, never the check.

**The npm CLIs live in `tools/`, not `[env]`.** Biome, Spectral, Honkit and
markdownlint-cli2 are exact `devDependencies` in `tools/package.json`, locked by
`tools/package-lock.json`, and run from `tools/node_modules/.bin`. The rules:

- **`task tools-install` is the one installer** (`npm ci --prefix tools
  --ignore-scripts`). `lint-json`, `lint-md`, `lint-openapi` and `pages-build`
  depend on it; CI's `lint` job runs it as its own step.
- **It writes `tools/node_modules/go.mod`**, the same Go-walker sentinel the
  frontend's postinstall drops (flatted ships Go source here too). A bare
  `npm ci --prefix tools` skips it, so anything that runs Go afterwards must use
  the task; `pages.yml` calls npm directly only because it runs no Go.
- **Hooks never install.** pre-commit is parallel and two concurrent `npm ci`
  runs into `tools/` corrupt it, so the `spectral`, `biome-json` and
  `markdownlint` hooks run `tools/node_modules/.bin` directly rather than a task
  that depends on `tools-install`; they only check that the binary exists and
  point at `task tools-install`.
- **`tools/.npmrc` keeps `min-release-age=7`, `save-exact=true` and
  `ignore-scripts=true`.** Dependabot's `/tools` entry bumps the CLIs in their
  own `tools-deps` PRs; by hand, `npm --prefix tools install <pkg>@<version>`.
  `devDependencies` keeps the tree out of Trivy's default scan and in dependency
  review's development scope.

`task check-deps` compares against upstream and **fails** on drift: the wails3
CLI, typos, Semgrep, schemathesis, jsonschema-rs, ruff, sqlfluff, zizmor,
gitleaks, Go and Node — plus two
cross-file assertions, the `crate-ci/typos@SHA  # vX.Y.Z` comment in `ci.yml`
and `.node-version` agreeing
with `[tools] node`. Deliberately unchecked: the MEASUREMENT pins
(`GOBCO_VERSION`, `TESSERACT_VERSION` — the version moves the number, so bumping
them is a re-baseline decision, not a version bump), golangci-lint (a bump is a
deliberate run-the-sweep-and-fix-what-it-finds change), the other exact
`[tools]` pins (bumped together by `task update-mise`), the `tools/` npm CLIs
and `SWAGGER_IMAGE`.

**Lockstep pin, both ecosystems**: `wails/v3` in `go.mod`, the `wails3` CLI in
`[tools]`, and `@wailsio/runtime` in `frontend/package.json` are ONE version.
Dependabot only sees `go.mod`, so it walks the module forward alone and silently
splits the three — check the other two after any wails bump. The CLI generates
the bindings the module must understand.

## Linting & dead code

- **deadcode allow-list is `scripts/ci/deadcode-allow.txt`.** `task
  dead-code-go`, `task verify`, and `ci.yml`'s "Dead Go code" step all shell out
  to `scripts/ci/deadcode-check.sh`, which reads one regex per line and fails on
  non-empty residual. New intentional unreachable: append a line to the
  allow-list, don't touch the three callers.
- **`deadcode` always exits 0** — findings print to stdout but the exit code is
  never non-zero. To gate, capture stdout and assert it's empty (or grep-filter
  expected stubs). See `task dead-code-go`.
- **`typos --force-exclude` required when filenames are passed explicitly.**
  `_typos.toml`'s `extend-exclude` only applies during dir walks. Lefthook passes
  `{staged_files}` as positional args → bypasses extend-exclude unless
  `--force-exclude` is set. Keep the flag whenever handing typos explicit paths
  (else binary `testdata/*.png` get scanned as text).
- **Pre-push is the fast core, and coverage is NOT in it.** The jobs are
  `actionlint`, `unit-go` (`go test -race -short ./...`), `unit-frontend`
  (`npx vitest run`, no coverage instrumentation), `gen-types-drift`,
  `test-skips`, `package-size`, and `package-size-history`. `conventional` is
  not one of them: it is the `commit-msg` hook, and CI's `commit-lint` job runs
  the same `scripts/ci/check-commit-subjects.sh` over every PR commit. The
  coverage GATE lives in CI and `task verify` — `GO_COVERAGE_MIN` plus
  `vitest.config.ts` `coverage.thresholds`. Skip one job with
  `LEFTHOOK_EXCLUDE=<job name> git push`, naming the job (e.g. `unit-go`), and
  only when CI will catch what you skipped.

## Go-walker & embed gotchas

- **`frontend/node_modules/` doesn't pollute `go list ./...`** — `flatted` ships
  a stray `golang/pkg/flatted/flatted.go` that Go's walker would absorb.
  `frontend/scripts/seed-go-sentinel.cjs` (npm `postinstall`) drops a stub
  `frontend/node_modules/go.mod` so the walker stops there; `frontend/dist` stays
  in the recall module for `//go:embed`. Belt-and-suspenders:
  `scripts/ci/deadcode-check.sh` filters `node_modules` out of `go list`, and
  golangci-lint excludes `frontend/node_modules` and `tools/node_modules` in
  both of `.golangci.yml`'s `exclusions.paths` lists, for a tree installed
  without its sentinel (gosec is rolled into `task lint-go` — the standalone
  gosec job and its `-exclude-dir` flag are both gone). New whole-program Go
  tools should keep the filter.

## Shell scripts

- **Standards-file references are gated by `scripts/ci/check-doc-paths.sh`**
  (`task check-doc-paths`, in the `lint` aggregate and CI). It asserts that every
  `` `task X` ``, `scripts/…` path and `docs/*.md` chapter named in the root
  CLAUDE.md, `frontend/CLAUDE.md`, `pkg/CLAUDE.md` and `.claude/rules/*.md`
  actually exists, and that nothing tells the reader to run `make`. Matching is
  backtick-anchored so English prose ("before declaring any task done") is not a
  hit. Rule files are picked up by a glob, so a new one needs nothing; a new
  NESTED `CLAUDE.md` (say `pkg/db/CLAUDE.md`) has to be added to that script's
  `DOC_FILES` loop by hand.
- **Bundle-size budget lives in `scripts/ci/check-bundle-size.sh`** — the single
  source of truth for the initial/total JS+CSS KB thresholds, run by the `ci.yml`
  "Enforce bundle-size budget" step. Edit thresholds here, not in any CLAUDE.md or
  rule (those only point at it).
- **`set -euo pipefail` is the house header** (36 of the 41 executable
  scripts under `scripts/`; the eight sourced libraries, `scripts/lib/_db.sh`
  and `scripts/release/smoke/{lib,cases}/`, are not counted). Drop `-e` only
  when the script's job is to keep going and report everything it found —
  `scripts/ci/audit-bundle.sh` and `scripts/tour-test.sh` (`set -u`) — or when a
  non-zero exit is the expected input to a retry, as in
  `scripts/ci/govulncheck-retry.sh` (`set -uo pipefail`).
  `scripts/ci/check-playwright-smoke.sh` and `scripts/ci/check-test-skips.sh`
  still use the older `set -eu`.
- **Release-time shell lives in `scripts/release/`** (not inline in
  `release.yml`): `package-wails-windows.sh`, `compute-sha256.sh`,
  `push-release-tag.sh`, `verify-release-ref.sh` (the tag guard `release.yml`'s
  `verify-ref` job runs), `fire-release.sh` (`task release-fire`, which runs that
  guard before it dispatches), `check-release-assets.sh` (the `sign-attest` job's
  last check on the asset directory the `release` job publishes whole),
  `verify-asset-digests.sh` (every job that downloads an artifact holds it to
  the digests its producer recorded as job outputs; `sign-attest` also to the
  file names that producer hands off), plus `smoke/smoke.sh`,
  which CI's `lint` job runs. Each takes its inputs from env
  vars or arguments set in the workflow step. Add new release-time
  logic as a `scripts/release/*.sh` (covered by `task lint-shell` via the
  `SHELL_SCRIPTS` glob), and its smoke cases as
  `scripts/release/smoke/cases/<script>.sh`: `smoke.sh` is only the runner, and
  the shared accounting, `run_case`, scratch repositories and gh stub live in
  `scripts/release/smoke/lib/_harness.sh`. The Linux/macOS
  packagers went with the Windows-only pivot — there is no `package-linux.sh`,
  `make-dmg.sh` or `sign-image.sh`, and no Dockerfile of any kind: the Windows
  app cross-compiles natively (`CGO_ENABLED=0`, pure-Go WebView2 loader), so the
  container build and its hadolint pragmas are gone with it.

## Installers & dev-server timing

- **NSIS installer** — `task build-windows` runs `wails3 task windows:package`
  (v3's Taskfile-native build under `build/`), which needs `makensis` on the HOST
  (`brew install nsis` / `apt install nsis`); there is no builder container.
  `VIProductVersion` in `build/windows/nsis/project.nsi` must be a numeric
  `x.x.x.x`, which is why the Taskfile passes `PRODUCT_VERSION_NUMERIC` — the
  release-please manifest version with any pre-release suffix stripped, falling
  back to `0.0.0` for `dev`. Output lands at
  `bin/recall-amd64-installer.exe`, copied to `dist/windows/`.
- **The install is PER-USER, not machine-wide** — `INSTALL_SCOPE=user` puts
  Recall in `$LOCALAPPDATA\Programs\Recall` with no UAC prompt, because the
  in-app self-updater swaps the running exe in place and can't elevate.
  `project.nsi` also removes any older machine-wide copy under
  `$PROGRAMFILES64`. Don't "fix" the scope back to machine-wide without dealing
  with the updater.
- **`task dev` is `wails3 dev -config ./build/config.yml -port 9245`** (override
  with `WAILS_VITE_PORT`), and it deletes the dev DB first — seed after boot.
  The Vite dev server must bind `127.0.0.1`, not `::1`: `vite.config.ts` sets
  `server.host` for exactly this reason, because Wails' proxy dials tcp4 and an
  IPv6-only bind surfaces as `dial tcp4 127.0.0.1:<port>: connect: connection
  refused` — which reads like a port conflict and isn't.
- **Smoke-test the server with isolated HOME** — the `serveronly` binary from the
  repo root hits real user data. For fresh-install behavior:
  `HOME=/tmp/recall-smoke RECALL_SERVER_ADDR=127.0.0.1:7099 ./recall-server` from
  a dir with no `./screenshots` (it otherwise listens on `127.0.0.1:7000`). Clean
  up with `rm -rf /tmp/recall-smoke/Library`.
