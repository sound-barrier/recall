#!/usr/bin/env bash
# Fail when a tool the build installs is not pinned to one exact release.
#
# A floating pin (`latest`, a bare major, `npx <pkg>@<version>`,
# `go install …@latest`)
# installs whatever upstream published that morning, so two machines, or a CI
# rerun, run different tools, and a compromised release reaches every run at
# once. Every pin here was made exact once, and each assertion below exists
# because a later edit can quietly float it again:
#
#   1. mise.toml [tools] values are exact releases (X.Y.Z, optional v and suffix).
#   2. mise.toml [env] *_VERSION strings are exact releases too.
#   3. .node-version (actions/setup-node) equals [tools] node.
#   4. mise.lock records every [tools] pin at that version, and every core: or
#      aqua: tool has a linux-x64 entry, the platform CI installs with --locked.
#   5. mise.lock has no uncommitted change, so an install never rewrote it.
#   6. No workflow, action, Taskfile, hook or script installs an @latest ref or
#      fetches an unlocked package on demand: `npx`/`npm exec`/`npm x` with
#      --yes, -y, --package or a <pkg>@<version> argument, `pnpm dlx`,
#      `yarn dlx`, `bunx`, `uvx`, `uv tool run` or `pipx run`. npx assumes
#      --yes in CI or without a TTY, so a bare `npx <name>` is allowed only
#      where <name> is a binary from a committed lockfile's node_modules.
#   7. Every `go install <module>@<version>` in those files names a literal
#      release, equal to the module's mise.toml pin when it has one; under
#      .github/ it must have one.
#   8. jdx/mise-action is used only inside .github/actions/setup-mise, whose
#      mise version and linux-x64 SHA-256 match mise.toml min_version and
#      scripts/install-mise.sh.
#   9. actions/setup-node reads .node-version, never a literal node-version.
#  10. tools/package.json pins exact versions, tools/package-lock.json exists,
#      and tools/.npmrc keeps the age gate, exact saves and no install scripts.
#
# Offline, and needs nothing beyond git, jq and the base system tools, so it runs
# early in CI's lint job. Every violation is reported, as a GitHub annotation,
# before it exits 1.
#
# Usage: bash scripts/ci/check-tool-pins.sh [repository root]

set -euo pipefail

readonly EXACT_RELEASE='^v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.]+)*$'
readonly EXACT_NPM_VERSION='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
# Leading flags, then the package or command token, quotes stripped.
readonly NPM_RUNNER="(^|[^[:alnum:]_./-])(npx|npm[[:space:]]+(exec|x))(([[:space:]]+-[^[:space:]]*)*)[[:space:]]+[\"']?([^[:space:]\"']+)"
readonly NPM_FETCH_FLAG='(^|[[:space:]])(--yes|-y|--package|-p)([[:space:]=]|$)'
readonly VERSIONED_PACKAGE='^(@[^/]+/)?[^@]+@.'
readonly DLX_RUNNER='(^|[^[:alnum:]_./-])((pnpm|yarn)[[:space:]]+dlx|bunx|uvx|uv[[:space:]]+tool[[:space:]]+run|pipx[[:space:]]+run)([[:space:]]|$)'
readonly ON_DEMAND_PREFILTER='npx|npm[[:space:]]+(exec|x)|dlx|bunx|uvx|uv[[:space:]]+tool[[:space:]]+run|pipx[[:space:]]+run'
readonly GO_INSTALL_REF="go[[:space:]]+install(([[:space:]]+-[^[:space:]]*)*)[[:space:]]+[\"']?([^[:space:]@\"']+)@[\"']?([^[:space:]'\"]*)"
readonly SETUP_MISE=".github/actions/setup-mise/action.yml"
readonly INSTALL_MISE="scripts/install-mise.sh"
readonly SELF="scripts/ci/check-tool-pins.sh"
# go-task is installed from its module but pinned under the aqua `task` key.
readonly GO_TASK_MODULE="github.com/go-task/task/v3/cmd/task"

REPO_ROOT="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/../..}" && pwd)"
cd "${REPO_ROOT}"

failures=0

# report <file> <line or empty> <message>
report() {
  if [[ -n "$2" ]]; then
    printf '::error file=%s,line=%s::%s\n' "$1" "$2" "$3"
  else
    printf '::error file=%s::%s\n' "$1" "$3"
  fi
  failures=$((failures + 1))
}

unquote() {
  if [[ "$1" =~ ^\"([^\"]*)\"$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  else
    printf '%s' "$1"
  fi
}

# Prints "<line>\t<key>\t<raw value>" for each `key = value` in one mise.toml
# table. Keys lose their quotes; values keep them, so a non-string shows.
toml_table_entries() {
  awk -v want="[$1]" '
    /^[[:space:]]*\[/ {
      header = $0
      sub(/[[:space:]]*#.*$/, "", header)
      in_table = (header == want)
      next
    }
    !in_table || /^[[:space:]]*(#|$)/ { next }
    {
      key = $0
      sub(/[[:space:]]*=.*$/, "", key)
      gsub(/"/, "", key)
      value = $0
      sub(/^[^=]*=[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      printf "%d\t%s\t%s\n", NR, key, value
    }
  ' mise.toml
}

tools_pin() {
  local line key raw
  while IFS=$'\t' read -r line key raw; do
    if [[ "${key}" == "$1" ]]; then
      unquote "${raw}"
      return
    fi
  done < <(toml_table_entries tools)
}

check_exact_mise_pins() {
  local line key raw
  while IFS=$'\t' read -r line key raw; do
    [[ "$(unquote "${raw}")" =~ ${EXACT_RELEASE} ]] && continue
    report mise.toml "${line}" "[tools] ${key} = ${raw} floats; pin one exact release (X.Y.Z)"
  done < <(toml_table_entries tools)
  while IFS=$'\t' read -r line key raw; do
    [[ "${key}" == *_VERSION ]] || continue
    [[ "$(unquote "${raw}")" =~ ${EXACT_RELEASE} ]] && continue
    report mise.toml "${line}" "[env] ${key} = ${raw} floats; pin one exact release (X.Y.Z)"
  done < <(toml_table_entries env)
}

check_node_version_file() {
  local pinned file_version
  pinned="$(tools_pin node)"
  if [[ ! -f .node-version ]]; then
    report .node-version "" ".node-version is missing; actions/setup-node reads it"
    return
  fi
  file_version="$(tr -d '[:space:]' <.node-version)"
  [[ "${file_version}" == "${pinned}" ]] \
    || report .node-version 1 ".node-version is ${file_version} but mise.toml [tools] node is ${pinned}; keep them equal"
}

# Prints "<key>\t<version>\t<backend>\t<1 if a linux-x64 entry exists>" for
# each [[tools.<key>]] block in mise.lock.
lock_entries() {
  awk '
    /^\[\[tools\./ {
      key = $0
      sub(/^\[\[tools\./, "", key)
      sub(/\]\][[:space:]]*$/, "", key)
      gsub(/"/, "", key)
      keys[++count] = key
      at_block_top = 1
      next
    }
    /^\[tools\..*\."platforms\.linux-x64"\]/ {
      key = $0
      sub(/^\[tools\./, "", key)
      sub(/\."platforms\.linux-x64"\][[:space:]]*$/, "", key)
      gsub(/"/, "", key)
      linux_x64[key] = 1
    }
    /^\[/ { at_block_top = 0; next }
    at_block_top && /^version = "/ { v = $0; gsub(/^version = "|".*$/, "", v); versions[count] = v }
    at_block_top && /^backend = "/ { b = $0; gsub(/^backend = "|".*$/, "", b); backends[count] = b }
    END {
      for (i = 1; i <= count; i++)
        printf "%s\t%s\t%s\t%d\n", keys[i], versions[i], backends[i], (keys[i] in linux_x64)
    }
  ' mise.lock
}

# check_lock_entry <mise.toml line> <key> <pin> <lock entries>
check_lock_entry() {
  local line="$1" key="$2" pin="$3" rows="$4"
  local lock_key version backend has_linux locked=""
  while IFS=$'\t' read -r lock_key version backend has_linux; do
    [[ "${lock_key}" == "${key}" ]] || continue
    locked="${locked:+${locked}, }${version}"
    [[ "${version#v}" == "${pin#v}" ]] || continue
    if [[ "${backend}" =~ ^(core|aqua): && "${has_linux}" != 1 ]]; then
      report mise.lock "" "${key} ${version} has no platforms.linux-x64 entry, so CI's --locked install fails; run mise lock with the pinned mise"
    fi
    return
  done <<<"${rows}"
  if [[ -z "${locked}" ]]; then
    report mise.toml "${line}" "[tools] ${key} has no [[tools.${key}]] block in mise.lock; run mise lock with the pinned mise"
  else
    report mise.toml "${line}" "[tools] ${key} = ${pin} but mise.lock records ${locked}; regenerate the lock with the pinned mise"
  fi
}

check_mise_lock() {
  local rows line key raw
  if [[ ! -f mise.lock ]]; then
    report mise.lock "" "mise.lock is missing; CI installs with --locked and needs it"
    return
  fi
  rows="$(lock_entries)"
  while IFS=$'\t' read -r line key raw; do
    check_lock_entry "${line}" "${key}" "$(unquote "${raw}")" "${rows}"
  done < <(toml_table_entries tools)
  if git rev-parse --git-dir >/dev/null 2>&1 && ! git diff --quiet -- mise.lock; then
    report mise.lock "" "mise.lock has uncommitted changes; an install rewrote it, or a pin moved without committing the lock"
  fi
}

# Workflows, composite actions, Taskfiles, hooks and shell scripts: everything
# that installs or runs a tool. This script is left out; it names the patterns.
install_surfaces() {
  find .github \( -name '*.yml' -o -name '*.yaml' \) -type f
  find build -name Taskfile.yml -type f 2>/dev/null || true
  find scripts -name '*.sh' -type f ! -path "${SELF}"
  local file
  for file in Taskfile.yml lefthook.yml initialize.sh .devcontainer/postCreate.sh; do
    [[ -f "${file}" ]] && printf '%s\n' "${file}"
  done
}

# check_npm_runners <file> <line> <text>: every npx/npm exec call on the line.
check_npm_runners() {
  local rest="$3" runner flags package
  while [[ "${rest}" =~ ${NPM_RUNNER} ]]; do
    runner="${BASH_REMATCH[2]}"
    flags="${BASH_REMATCH[4]} "
    package="${BASH_REMATCH[6]}"
    rest="${rest#*"${BASH_REMATCH[0]}"}"
    [[ "${package}" == -* ]] && flags+="${package}"
    if [[ "${flags}" =~ ${NPM_FETCH_FLAG} || "${package}" =~ ${VERSIONED_PACKAGE} ]]; then
      report "$1" "$2" "${runner} ${package} fetches an unlocked package on demand; pin it in tools/package.json and run tools/node_modules/.bin"
    fi
  done
}

check_floating_installs() {
  local file line text
  while IFS=: read -r file line text; do
    if [[ "${text}" == *@latest* ]]; then
      report "${file}" "${line}" "@latest installs whatever was published last; name an exact version"
    fi
    if [[ "${text}" =~ ${DLX_RUNNER} ]]; then
      report "${file}" "${line}" "${BASH_REMATCH[2]} fetches an unlocked package on demand; pin the tool in mise.toml or tools/package.json"
    fi
    check_npm_runners "${file}" "${line}" "${text}"
  done < <(install_surfaces | sort -u | tr '\n' '\0' | xargs -0 grep -HnE "@latest|${ON_DEMAND_PREFILTER}" || true)
}

check_go_install_pins() {
  local file line text module version pin_key pin
  while IFS=: read -r file line text; do
    [[ "${text}" =~ ${GO_INSTALL_REF} ]] || continue
    module="${BASH_REMATCH[3]}"
    version="${BASH_REMATCH[4]}"
    if [[ ! "${version}" =~ ${EXACT_RELEASE} ]]; then
      report "${file}" "${line}" "go install ${module}@${version} is not a literal release; name the mise.toml pin (vX.Y.Z)"
      continue
    fi
    pin_key="go:${module}"
    [[ "${module}" == "${GO_TASK_MODULE}" ]] && pin_key="task"
    pin="$(tools_pin "${pin_key}")"
    if [[ -z "${pin}" && "${file}" == .github/* ]]; then
      report "${file}" "${line}" "go install ${module}@${version} has no mise.toml [tools] \"${pin_key}\" pin to match"
    elif [[ -n "${pin}" && "${version#v}" != "${pin#v}" ]]; then
      report "${file}" "${line}" "go install ${module}@${version} but mise.toml [tools] \"${pin_key}\" = ${pin}; bump both together"
    fi
  done < <(install_surfaces | sort -u | tr '\n' '\0' | xargs -0 grep -HnE 'go[[:space:]]+install[[:space:]].*@' || true)
}

check_mise_action_uses() {
  local file line text
  while IFS=: read -r file line text; do
    [[ "${file}" == "${SETUP_MISE}" ]] && continue
    report "${file}" "${line}" "calls jdx/mise-action directly; use ./.github/actions/setup-mise, which pins and checksums mise"
  done < <(grep -rHniE "^[[:space:]]*(-[[:space:]]*)?uses:[[:space:]]*[\"']?jdx/mise-action@" .github || true)
}

setup_mise_input() {
  sed -nE "s/^[[:space:]]+$1:[[:space:]]*['\"]?([^'\"[:space:]]+)['\"]?[[:space:]]*$/\1/p" "${SETUP_MISE}" | head -1
}

install_mise_linux_x64_sha256() {
  awk '/target="linux-x64"/ { found = 1; next } found && /sha256="/ { gsub(/^[^"]*"|".*$/, ""); print; exit }' "${INSTALL_MISE}"
}

# The one mise release, in the four places that must name it together.
check_mise_bootstrap_version() {
  local version sha256 min_version script_version
  if [[ ! -f "${SETUP_MISE}" || ! -f "${INSTALL_MISE}" ]]; then
    report "${SETUP_MISE}" "" "${SETUP_MISE} and ${INSTALL_MISE} must both exist; they pin the mise bootstrap"
    return
  fi
  version="$(setup_mise_input version)"
  sha256="$(setup_mise_input sha256)"
  min_version="$(unquote "$(sed -nE 's/^min_version[[:space:]]*=[[:space:]]*(.*)$/\1/p' mise.toml | head -1)")"
  script_version="$(sed -nE 's/^MISE_VERSION="([^"]*)"$/\1/p' "${INSTALL_MISE}" | head -1)"
  [[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || report "${SETUP_MISE}" "" "setup-mise version '${version}' is not one exact mise release"
  [[ "${sha256}" =~ ^[0-9a-f]{64}$ ]] \
    || report "${SETUP_MISE}" "" "setup-mise has no 64-hex sha256 for the mise binary"
  [[ "${min_version}" == "${version}" ]] \
    || report mise.toml "" "min_version ${min_version} differs from setup-mise version ${version}; bump them together"
  [[ "${script_version}" == "${version}" ]] \
    || report "${INSTALL_MISE}" "" "MISE_VERSION ${script_version} differs from setup-mise version ${version}; bump them together"
  [[ "$(install_mise_linux_x64_sha256)" == "${sha256}" ]] \
    || report "${INSTALL_MISE}" "" "the linux-x64 sha256 differs from setup-mise's sha256; both hash the same mise binary"
}

check_setup_node_version_file() {
  local file line text
  while IFS=: read -r file line text; do
    report "${file}" "${line}" "names a literal node-version; use node-version-file: .node-version"
  done < <(grep -rHnE '^[[:space:]]*node-version:' .github || true)
}

# npmrc_setting <key>: the value npm resolves from tools/.npmrc, where the last
# top-level assignment wins and ; or # starts a comment.
npmrc_setting() {
  awk -v want="$1" '
    /^[[:space:]]*\[.*\][[:space:]]*$/ { exit }
    /^[[:space:]]*([#;]|$)/ { next }
    {
      key = $0
      value = "true"
      if (index($0, "=")) {
        key = substr($0, 1, index($0, "=") - 1)
        value = substr($0, index($0, "=") + 1)
      }
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key != want) next
      if (value !~ /^[[:space:]]*["\047]/) sub(/[#;].*$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^["\047]|["\047]$/, "", value)
      found = value
    }
    END { print found }
  ' tools/.npmrc 2>/dev/null
}

check_tools_npm_pins() {
  local name spec key want
  if [[ ! -f tools/package.json ]]; then
    report tools/package.json "" "tools/package.json is missing; the npm CLIs have no exact pin"
    return
  fi
  [[ -f tools/package-lock.json ]] \
    || report tools/package-lock.json "" "tools/package-lock.json is missing; npm ci has nothing to install exactly"
  while IFS=$'\t' read -r name spec; do
    [[ "${spec}" =~ ${EXACT_NPM_VERSION} ]] && continue
    report tools/package.json "$(grep -nF "\"${name}\"" tools/package.json | head -1 | cut -d: -f1)" \
      "${name} is \"${spec}\", a range; pin one exact version"
  done < <(jq -r '[.dependencies, .devDependencies, .optionalDependencies, .peerDependencies, .overrides] | map(. // {} | to_entries[]) | .[] | "\(.key)\t\(.value)"' tools/package.json)
  while IFS='=' read -r key want; do
    [[ "$(npmrc_setting "${key}")" == "${want}" ]] \
      || report tools/.npmrc "" "tools/.npmrc must set ${key}=${want}, and no later line may override it"
  done <<<$'min-release-age=7\nsave-exact=true\nignore-scripts=true'
}

check_exact_mise_pins
check_node_version_file
check_mise_lock
check_floating_installs
check_go_install_pins
check_mise_action_uses
check_mise_bootstrap_version
check_setup_node_version_file
check_tools_npm_pins

if [[ "${failures}" -gt 0 ]]; then
  printf '\ncheck-tool-pins: %d floating or mismatched pin(s). See CONTRIBUTING.md (Tool pins and the mise lockfile).\n' "${failures}" >&2
  exit 1
fi
echo "Tool pins: every tool is pinned to one exact release, and the pins agree."
