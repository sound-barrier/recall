---
paths:
  - "Taskfile.yml"
  - "mise.toml"
  - "Dockerfile*"
  - "scripts/**"
  - "lefthook.yml"
  - "*.nsi"
  - "initialize.sh"
  - ".devcontainer/**"
---

# Build & tooling conventions

## Pinned tool versions

Live in `mise.toml` — `[tools]` for anything mise installs, `[env]` for the
versions the tasks and hooks read themselves (`SPECTRAL_VERSION`,
`TYPOS_VERSION`, `SEMGREP_VERSION`, `HONKIT_VERSION`, `SCHEMATHESIS_VERSION`,
`JSONSCHEMA_RS_VERSION`, `GOBCO_VERSION`, `RUFF_VERSION`, `SQLFLUFF_VERSION`,
`BIOME_VERSION`, and `TESSERACT_VERSION` — that last one informational
major.minor, so a mismatch means re-baseline `testdata/*.golden.json` and bump).

Consumers no longer read a file; they read the environment mise puts them in:

- **Locally** — `mise activate` exports `[env]`, so `Taskfile.yml` and
  `lefthook.yml` reference `$SPECTRAL_VERSION` and friends directly.
- **CI** — `jdx/mise-action` loads `mise.toml [env]` into `$GITHUB_ENV` for every
  job regardless of `install_args`. That is also why `DEFAULT_MAX_FILES` must
  never be added to `[env]`: it would silently override the package-size gate.

`task check-deps` validates the upstream pins plus the `crate-ci/typos@SHA  #
vX.Y.Z` comment in `ci.yml`. **Swagger UI image** (`SWAGGER_IMAGE`) is the only
unchecked pin.

## Linting & dead code

- **deadcode allow-list is `scripts/ci/deadcode-allow.txt`.** `task
  dead-code-go`, `lefthook.yml` `pre-push.deadcode`, and `ci.yml` "Dead Go code"
  all shell out to `scripts/ci/deadcode-check.sh` which reads one regex per line and
  fails on non-empty residual. New intentional unreachable: append a line to the
  allow-list, don't touch the three callers.
- **`deadcode` always exits 0** — findings print to stdout but the exit code is
  never non-zero. To gate, capture stdout and assert it's empty (or grep-filter
  expected stubs). See `task dead-code-go`.
- **`typos --force-exclude` required when filenames are passed explicitly.**
  `_typos.toml`'s `extend-exclude` only applies during dir walks. Lefthook passes
  `{staged_files}` as positional args → bypasses extend-exclude unless
  `--force-exclude` is set. Keep the flag whenever handing typos explicit paths
  (else binary `testdata/*.png` get scanned as text).
- **Pre-push hook runs `task cover`** — every `git push` reproduces Go + Vitest
  coverage (~3-5 s). Gates on `GO_COVERAGE_MIN` + `vitest.config.ts`
  `coverage.thresholds`. Skip with `LEFTHOOK_EXCLUDE=coverage git push` only if
  you trust CI to catch it.
- **`# hadolint ignore=DL4006`** above any Dockerfile `RUN` containing a shell
  pipe; same shape as `# hadolint ignore=DL3008` for unpinned apt.

## Go-walker & embed gotchas

- **`frontend/node_modules/` doesn't pollute `go list ./...`** — `flatted` ships
  a stray `golang/pkg/flatted/flatted.go` that Go's walker would absorb.
  `frontend/scripts/seed-go-sentinel.cjs` (npm `postinstall`) drops a stub
  `frontend/node_modules/go.mod` so the walker stops there; `frontend/dist` stays
  in the recall module for `//go:embed`. Belt-and-suspenders:
  `scripts/ci/deadcode-check.sh` filters `node_modules` out of `go list`, and
  golangci-lint excludes `frontend/node_modules` via `.golangci.yml`'s
  `issues.exclude-dirs` (gosec is rolled into `task lint-go` — the standalone
  gosec job and its `-exclude-dir` flag are both gone). New whole-program Go
  tools should keep the filter.
- **`Dockerfile.build` frontend-builder runs `npm ci` BEFORE copying full
  `frontend/` source** — only `package.json`, `package-lock.json`, and
  `frontend/scripts/seed-go-sentinel.cjs` are in the layer. The sentinel is
  required because `package.json`'s `postinstall` invokes it; without the explicit
  `COPY frontend/scripts/seed-go-sentinel.cjs ./scripts/...` line, npm ci dies and
  every Docker build breaks. Any new postinstall hook referencing a project file
  needs the same up-front COPY.

## Shell scripts

- **Standards-file references are gated by `scripts/ci/check-doc-paths.sh`**
  (`task check-doc-paths`, in the `lint` aggregate and CI). It asserts that every
  `` `task X` ``, `scripts/…` path and `docs/*.md` chapter named in the root
  CLAUDE.md, `frontend/CLAUDE.md`, `pkg/CLAUDE.md` and `.claude/rules/*.md`
  actually exists, and that nothing tells the reader to run `make`. Matching is
  backtick-anchored so English prose ("before declaring any task done") is not a
  hit. A new nested CLAUDE.md goes on that script's `DOC_FILES` list.
- **Bundle-size budget lives in `scripts/ci/check-bundle-size.sh`** — the single
  source of truth for the initial/total JS+CSS KB thresholds, run by the `ci.yml`
  "Enforce bundle-size budget" step. Edit thresholds here, not in any CLAUDE.md or
  rule (those only point at it).
- **`set -u` not `-e`** in shell scripts that should keep going after an
  individual failure (`verify-stack.sh` is the canonical example).
- **Release-time shell lives in `scripts/release/`** (not inline in
  `release.yml`): `package-wails-windows.sh`, `compute-sha256.sh`,
  `push-release-tag.sh`, plus `smoke/`. Each reads inputs from env vars set in the
  workflow step. Add new release-time logic as a `scripts/release/*.sh` (covered
  by `task lint-shell` via the `SHELL_SCRIPTS` glob). The Linux/macOS packagers
  went with the Windows-only pivot — there is no `package-linux.sh`,
  `make-dmg.sh` or `sign-image.sh`.

## Installers & dev-server timing

- **NSIS installer** — `wails build -nsis` needs the `nsis` apt package in the
  `windows-builder` stage for `makensis`. `VIProductVersion` in `project.nsi` must
  be numeric `x.x.x.x` — strip pre-release suffix before injecting
  (`0.0.10-beta.0` → `0.0.10` via `grep -oE '^[0-9]+\.[0-9]+\.[0-9]+'`, fallback
  `0.0.0` for `dev`). Output: `build/bin/${INFO_PROJECTNAME}-${ARCH}-installer.exe`.
  Install path: `$PROGRAMFILES64\${INFO_PRODUCTNAME}` (no company subfolder).
- **`wails dev` takes ~12-14 s** before its AssetServer (`:34115`) responds. When
  probing routes via `curl` from a script, sleep at least 14 s after starting the
  dev server. Vite (`:5173`) is up faster but doesn't see custom handlers.
- **Smoke-test the server with isolated HOME** — `recall-server` from repo root
  hits real user data. For fresh-install behavior:
  `HOME=/tmp/recall-smoke RECALL_SERVER_ADDR=127.0.0.1:7099 ./recall-server` from
  a dir with no `./screenshots`. Clean up with `rm -rf /tmp/recall-smoke/Library`.
