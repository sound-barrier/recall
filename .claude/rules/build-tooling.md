---
paths:
  - "Makefile"
  - "Dockerfile*"
  - "scripts/**"
  - "tool-versions.env"
  - "lefthook.yml"
  - "*.nsi"
  - "initialize.sh"
  - ".devcontainer/**"
---

# Build & tooling conventions

## Pinned tool versions

Live in `tool-versions.env`. Keys: `SPECTRAL_VERSION`, `TYPOS_VERSION`,
`SEMGREP_VERSION`, `HONKIT_VERSION`, `TESSERACT_VERSION`
(informational major.minor — mismatch = re-baseline `testdata/*.golden.json` and
bump). Consumers:

- `Makefile` — `include tool-versions.env`
- `lefthook.yml` — `. ./tool-versions.env`
- `ci.yml` + `pages.yml` — `grep -E '^[A-Z_][A-Z0-9_]*=' tool-versions.env >> "$GITHUB_ENV"` (grep filter required — Actions' env validator rejects comments)
- `initialize.sh` + `.devcontainer/postCreate.sh` — `. tool-versions.env`

`make check-deps` validates all four upstream + the `crate-ci/typos@SHA  #
vX.Y.Z` comment in `ci.yml`. Wails CLI / hadolint / lefthook / trivy still
duplicated between `initialize.sh` and `postCreate.sh`; `make check-deps` parses
both. **Swagger UI image** (`SWAGGER_IMAGE`) is the only unchecked pin.

## Linting & dead code

- **deadcode allow-list is `scripts/deadcode-allow.txt`.** `Makefile`
  `dead-code-go`, `lefthook.yml` `pre-push.deadcode`, and `ci.yml` "Dead Go code"
  all shell out to `scripts/deadcode-check.sh` which reads one regex per line and
  fails on non-empty residual. New intentional unreachable: append a line to the
  allow-list, don't touch the three callers.
- **`deadcode` always exits 0** — findings print to stdout but the exit code is
  never non-zero. To gate, capture stdout and assert it's empty (or grep-filter
  expected stubs). See `make dead-code-go`.
- **`typos --force-exclude` required when filenames are passed explicitly.**
  `_typos.toml`'s `extend-exclude` only applies during dir walks. Lefthook passes
  `{staged_files}` as positional args → bypasses extend-exclude unless
  `--force-exclude` is set. Keep the flag whenever handing typos explicit paths
  (else binary `testdata/*.png` get scanned as text).
- **Pre-push hook runs `make cover`** — every `git push` reproduces Go + Vitest
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
  `scripts/deadcode-check.sh` filters `node_modules`, `make lint-gosec` passes
  `-exclude-dir=frontend`. New whole-program Go tools should keep the filter.
- **`Dockerfile.build` frontend-builder runs `npm ci` BEFORE copying full
  `frontend/` source** — only `package.json`, `package-lock.json`, and
  `frontend/scripts/seed-go-sentinel.cjs` are in the layer. The sentinel is
  required because `package.json`'s `postinstall` invokes it; without the explicit
  `COPY frontend/scripts/seed-go-sentinel.cjs ./scripts/...` line, npm ci dies and
  every Docker build breaks. Any new postinstall hook referencing a project file
  needs the same up-front COPY.

## Shell scripts

- **Bundle-size budget lives in `scripts/check-bundle-size.sh`** — the single
  source of truth for the initial/total JS+CSS KB thresholds, run by the `ci.yml`
  "Enforce bundle-size budget" step. Edit thresholds here, not in any CLAUDE.md or
  rule (those only point at it).
- **`set -u` not `-e`** in shell scripts that should keep going after an
  individual failure (`verify-stack.sh` is the canonical example).
- **Release-time shell lives in `scripts/release/`** (not inline in
  `release.yml`): `package-linux.sh`, `make-dmg.sh`, `sign-image.sh`,
  `flip-package-public.sh`, `compute-sha256.sh`. Each reads inputs from env vars
  set in the workflow step. Add new release-time logic as a `scripts/release/*.sh`
  (covered by `make lint-shell` via the `SHELL_SCRIPTS` glob).

## Installers & dev-server timing

- **NSIS installer** — `wails build -nsis` needs the `nsis` apt package in the
  `windows-builder` stage for `makensis`. `VIProductVersion` in `project.nsi` must
  be numeric `x.x.x.x` — strip pre-release suffix before injecting
  (`0.0.10-beta.0` → `0.0.10` via `grep -oE '^[0-9]+\.[0-9]+\.[0-9]+'`, fallback
  `0.0.0` for `dev`). Output: `build/bin/${INFO_PROJECTNAME}-${ARCH}-installer.exe`.
  Install path: `$PROGRAMFILES64\${INFO_PRODUCTNAME}` (no company subfolder).
- **macOS in-DMG `README.txt` lives at `docs/dmg/README.txt`** — single source
  for drag-install + Gatekeeper steps; `scripts/release/make-dmg.sh` copies it
  into the DMG. `docs/install-macos.md` sections 2-3 mirror it. Synced pair
  flagged by an HTML comment at the top of the install-macos.md region.
- **`wails dev` takes ~12-14 s** before its AssetServer (`:34115`) responds. When
  probing routes via `curl` from a script, sleep at least 14 s after starting the
  dev server. Vite (`:5173`) is up faster but doesn't see custom handlers.
- **Smoke-test the server with isolated HOME** — `recall-server` from repo root
  hits real user data. For fresh-install behavior:
  `HOME=/tmp/recall-smoke RECALL_SERVER_ADDR=127.0.0.1:7099 ./recall-server` from
  a dir with no `./screenshots`. Clean up with `rm -rf /tmp/recall-smoke/Library`.
