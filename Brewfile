# Recall — Homebrew bootstrap for local development (macOS).
#
# This file installs only what mise can't (or shouldn't) manage: mise itself,
# the system OCR runtime, the container runtime, and a couple of misc CLIs.
# Everything else — the Go/Node toolchains and every linter/formatter/scanner —
# is pinned in mise.toml and provisioned by `mise install`.
#
# First-time setup:
#   brew bundle           # this file → mise + system packages
#   mise trust && mise install   # mise.toml → toolchain + linters
#   lefthook install      # wire git hooks (lefthook comes from mise)
#
# Update:   brew bundle --upgrade   (then `mise upgrade` for mise-managed tools)
# Status:   brew bundle check

# mise — toolchain + environment manager. The single entry point: it reads
# mise.toml to install pinned versions of go, node, task (go-task), and every
# linter, and injects RECALL_DATA_DIR + the version pins into the shell.
brew "mise"

# go-task — the build runner (replaces make; recipes live in Taskfile.yml).
# Also pinned in mise.toml [tools]; installing it here too means `task` works
# the moment `brew bundle` finishes, before `mise install`. Whichever copy is
# first on PATH wins (mise's shim takes precedence once activated).
brew "go-task/tap/go-task"

# Tesseract OCR engine. The parser shells out to the `tesseract` CLI on PATH
# to read text from screenshots. A system runtime, not a mise tool.
brew "tesseract"

# Container runtime + compose for the bundled Prometheus + Grafana stack AND
# for `task swagger` (swaggerapi/swagger-ui pointed at api/openapi.yaml).
# Podman is what we test against; the compose file is plain v3 so Docker (with
# Colima or Desktop) also works — pass `DOCKER=docker` to any container task.
brew "podman"
brew "podman-compose"

# pipx — Python apps in isolated venvs. mise's `pipx:` backend (semgrep,
# schemathesis) shells out to pipx, so it must exist before `mise install`.
brew "pipx"

# Line-count tool (used by `task cloc`). Not in mise's registry.
brew "cloc"
