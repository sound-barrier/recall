#!/usr/bin/env bash
# Count source lines: the tracked repository, then the production Go and
# TypeScript Recall ships, then the tests beside them as a ratio. Advisory, a
# report and never a gate.
#
# Production Go is decided by the import graph, not a hand-kept list: the
# non-test files of every package the app's main package compiles in, for the
# shipped Windows desktop build and the serveronly build (Windows, and the
# Linux one e2e runs). Test support and CI or maintainer tools drop out
# because the app never imports them. The Go tests counted are those same
# packages' _test.go files.
#
# Production frontend is the hand-written .ts, .js and .vue under frontend/src:
# no *.test.ts, no src/test-utils, and no src/client, which `task gen-types`
# regenerates from api/openapi.yaml. Its tests are the Vitest files plus the
# Playwright suite under frontend/tests.
#
# The ratios compare cloc's `code` column: lines that are neither blank nor
# comment.
#
# Usage: bash scripts/cloc-report.sh   (task cloc runs `task tools-install` first)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

CLOC="tools/node_modules/.bin/cloc"
if [[ ! -x "${CLOC}" ]]; then
  echo "cloc-report: ${CLOC} is missing; run: task tools-install" >&2
  exit 1
fi

lists="$(mktemp -d)"
trap 'rm -rf "${lists}"' EXIT

# go_list_files FIELDS... prints the repo-relative files in the named go list
# fields (GoFiles, TestGoFiles, XTestGoFiles) for every package of this module
# the app's main package depends on, across the three production builds.
go_list_files() {
  local module fields="" field
  module="$(go list -m)"
  for field in "$@"; do
    fields+="{{range .${field}}}{{\$dir}}/{{.}}{{\"\\n\"}}{{end}}"
  done
  local format="{{if .Module}}{{if eq .Module.Path \"${module}\"}}{{\$dir := .Dir}}${fields}{{end}}{{end}}"
  {
    GOOS=windows GOARCH=amd64 go list -e -deps -f "${format}" .
    GOOS=windows GOARCH=amd64 go list -e -deps -tags serveronly -f "${format}" .
    GOOS=linux GOARCH=amd64 go list -e -deps -tags serveronly -f "${format}" .
  } | sed "s#^${PWD}/##" | sort -u
}

frontend_production_files() {
  git ls-files -- 'frontend/src/*.ts' 'frontend/src/*.js' 'frontend/src/*.vue' \
    | grep -vE '\.test\.ts$|^frontend/src/(test-utils|client)/'
}

frontend_unit_test_files() {
  git ls-files -- 'frontend/src/*.test.ts' 'frontend/src/test-utils/*'
}

frontend_e2e_test_files() {
  git ls-files -- 'frontend/tests/*.ts' 'frontend/tests/*.js'
}

# code_lines LIST_FILE prints the summed `code` count cloc reports for it.
code_lines() {
  if [[ ! -s "$1" ]]; then
    echo 0
    return
  fi
  "${CLOC}" --list-file="$1" --csv --quiet --sum-one | awk -F, '$2 == "SUM" { print $5 }'
}

ratio() {
  awk -v tests="$1" -v production="$2" \
    'BEGIN { if (production == 0) print "n/a"; else printf "%.2f\n", tests / production }'
}

heading() {
  printf '\n[ recall ] %s\n' "$1"
}

heading "Tracked repository (.clocrc)"
"${CLOC}" --config .clocrc --quiet .

go_list_files GoFiles >"${lists}/go-production"
go_list_files TestGoFiles XTestGoFiles >"${lists}/go-tests"
frontend_production_files >"${lists}/frontend-production"
frontend_unit_test_files >"${lists}/frontend-unit"
frontend_e2e_test_files >"${lists}/frontend-e2e"
cat "${lists}/frontend-unit" "${lists}/frontend-e2e" >"${lists}/frontend-tests"

heading "Production Go (what the app binary compiles in)"
"${CLOC}" --list-file="${lists}/go-production" --quiet --hide-rate

heading "Production frontend (hand-written frontend/src)"
"${CLOC}" --list-file="${lists}/frontend-production" --quiet --hide-rate

go_production="$(code_lines "${lists}/go-production")"
go_tests="$(code_lines "${lists}/go-tests")"
frontend_production="$(code_lines "${lists}/frontend-production")"
frontend_unit="$(code_lines "${lists}/frontend-unit")"
frontend_e2e="$(code_lines "${lists}/frontend-e2e")"
frontend_tests="$(code_lines "${lists}/frontend-tests")"

heading "Test to production (code lines)"
printf '  %-10s production %7d   tests %7d   ratio %s\n' \
  "Go" "${go_production}" "${go_tests}" "$(ratio "${go_tests}" "${go_production}")"
printf '  %-10s production %7d   tests %7d   ratio %s  (unit %d, e2e %d)\n' \
  "Frontend" "${frontend_production}" "${frontend_tests}" \
  "$(ratio "${frontend_tests}" "${frontend_production}")" "${frontend_unit}" "${frontend_e2e}"
