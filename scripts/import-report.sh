#!/usr/bin/env bash
# scripts/import-report.sh — turn a user's parse-problem report into fixture
# work: which screenshots are new to the corpus, what the parser reads from
# them today, and what the reporter says they should have read.
#
# Why this script exists: every report used to mean unzipping by hand,
# eyeballing which images the corpus already had, copying the new ones into
# the recall-testdata submodule, and running the golden generator. This does
# all of that in one pass, and it refuses to put an image into the PUBLIC
# corpus unless the reporter ticked the form's test-corpus box (--consented).
#
# Usage:
#   scripts/import-report.sh [--consented] <report.zip>
#   task import-report BUNDLE=<report.zip> [CONSENTED=1]
#
# Accepts a recall-diagnostic/v2 or v3 report (what "Report parse problem…"
# saves) or the screenshots of a recall-bundle/v1 export, which older reports
# attached instead.
#
# Output:
#   tmp/reports/<name>/new/        each screenshot the corpus lacks, with the
#                                  golden the parser writes for it today
#   tmp/report-<name>.md           the triage summary: notes, failures, hashes
#   testdata/images/, testdata/    (--consented only) the new images and their
#                                  goldens, ready to correct against the notes
#
# Requires: jq, unzip, a Go toolchain, and Tesseract on PATH for the goldens
# (without Tesseract the images are still staged, just not parsed).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly CORPUS_IMAGES="${REPO_ROOT}/testdata/images"
readonly CORPUS_GOLDENS="${REPO_ROOT}/testdata"

err() {
  echo "[ import-report ] $*" >&2
}

die() {
  err "$*"
  exit 1
}

info() {
  echo "[ import-report ] $*"
}

sha256_of() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# corpus_index prints "<sha256> <filename>" for every image the corpus holds:
# the submodule plus the few kept committed at testdata/ for the docs.
corpus_index() {
  local img
  for img in "${CORPUS_IMAGES}"/* "${CORPUS_GOLDENS}"/*; do
    case "${img}" in
      *.png | *.jpg | *.jpeg) echo "$(sha256_of "${img}") $(basename "${img}")" ;;
    esac
  done
}

check_schema() {
  local schema="$1"
  case "${schema}" in
    recall-diagnostic/v2 | recall-diagnostic/v3 | recall-bundle/v1) ;;
    *) die "not a Recall report: manifest schema is '${schema}'" ;;
  esac
}

# known_as prints the corpus filename sharing this hash, or nothing.
known_as() {
  local hash="$1" index="$2"
  grep -m1 "^${hash} " "${index}" | cut -d' ' -f2- || true
}

# stage_new copies each screenshot the corpus lacks into new/ and writes one
# "<filename>\t<status>" line per screenshot to the status file.
stage_new() {
  local unpacked="$1" new_dir="$2" index="$3" status_file="$4"
  local img name known
  mkdir -p "${new_dir}"
  : >"${status_file}"
  for img in "${unpacked}"/screenshots/*; do
    [[ -f "${img}" ]] || continue
    name="$(basename "${img}")"
    known="$(known_as "$(sha256_of "${img}")" "${index}")"
    if [[ -n "${known}" ]]; then
      printf '%s\tknown, in the corpus as %s\n' "${name}" "${known}" >>"${status_file}"
      continue
    fi
    cp "${img}" "${new_dir}/"
    printf '%s\tnew\n' "${name}" >>"${status_file}"
  done
}

generate_goldens() {
  local new_dir="$1"
  if ! compgen -G "${new_dir}/*" >/dev/null; then
    return
  fi
  if ! command -v tesseract >/dev/null; then
    err "tesseract not on PATH; staged the new images without goldens"
    return
  fi
  info "parsing the new screenshots…"
  bash "${REPO_ROOT}/scripts/gen-goldens.sh" "${new_dir}" >/dev/null
}

# publish_new copies the new images into the submodule and their goldens
# beside the others. A name already in the corpus with different bytes is
# left for the maintainer to rename by hand rather than overwritten.
publish_new() {
  local new_dir="$1" img name
  [[ -e "${CORPUS_IMAGES}/.git" ]] || die "testdata/images isn't checked out; run 'task fetch-fixtures' first"
  for img in "${new_dir}"/*; do
    case "${img}" in
      *.golden.json | "${new_dir}/*") continue ;;
    esac
    name="$(basename "${img}")"
    if [[ -e "${CORPUS_IMAGES}/${name}" ]]; then
      err "skipped ${name}: the corpus has a different image by that name"
      continue
    fi
    cp "${img}" "${CORPUS_IMAGES}/"
    if [[ -f "${img}.golden.json" ]]; then
      cp "${img}.golden.json" "${CORPUS_GOLDENS}/"
    fi
    info "added ${name} to the corpus"
  done
}

write_summary_header() {
  local manifest="$1" bundle="$2"
  jq -r --arg bundle "$(basename "${bundle}")" '
    "# Parse report: \($bundle)\n",
    "- Schema: `\(.schema)`",
    "- Recall: \(.recall_version // "unknown")",
    (if .environment then "- Environment: \(.environment.os) / \(.environment.arch), Tesseract \(.environment.tesseract_version // "not found")"
     else "- Environment: not recorded (an export bundle, not a parse report; it carries no notes either)" end),
    "",
    "## Likely causes\n",
    (if (.likely_causes // []) | length == 0 then "None found."
     else (.likely_causes[] | "- `\(.code)`\(if .filename then " (\(.filename))" else "" end): \(.message)") end),
    ""
  ' "${manifest}"
}

# write_summary_files joins each screenshot's corpus status to what the
# manifest says about it. A recall-bundle/v1 carries no notes or failures.
write_summary_files() {
  local manifest="$1" status_file="$2" name status
  echo "## Screenshots"
  echo
  echo "| File | Corpus | Reporter's note | Failure |"
  echo "|---|---|---|---|"
  while IFS=$'\t' read -r name status; do
    jq -r --arg name "${name}" --arg status "${status}" '
      ((.files // []) | map(select(.filename == $name)) | first) as $f
      | def cell: gsub("\n"; " ") | gsub("\\|"; "\\|");
        "| `\($name)` | \($status) | \($f.note // "" | cell) | \($f.failure.error // "" | cell) |"
    ' "${manifest}"
  done <"${status_file}"
}

write_summary_next() {
  local consented="$1" new_dir="$2"
  echo
  echo "## Next"
  echo
  echo "Each new screenshot's golden in \`${new_dir#"${REPO_ROOT}"/}\` is what the"
  echo "parser reads today. Correct it to the reporter's note, then fix the"
  echo "parser until \`task test\` passes against the corrected golden."
  if [[ "${consented}" != 1 ]]; then
    echo
    echo "No corpus consent: keep these images out of recall-testdata."
  fi
}

main() {
  local consented=0
  if [[ "${1:-}" == --consented ]]; then
    consented=1
    shift
  fi
  [[ $# -eq 1 && -n "$1" ]] || die "usage: import-report.sh [--consented] <report.zip>"
  local bundle="$1"
  [[ -f "${bundle}" ]] || die "no such file: ${bundle}"

  local name work unpacked manifest new_dir index status_file summary
  name="$(basename "${bundle}" .zip)"
  work="${REPO_ROOT}/tmp/reports/${name}"
  unpacked="${work}/unpacked"
  new_dir="${work}/new"
  index="${work}/corpus.sha256"
  status_file="${work}/status.tsv"
  summary="${REPO_ROOT}/tmp/report-${name}.md"
  rm -rf "${work}"
  mkdir -p "${unpacked}"
  unzip -q "${bundle}" -d "${unpacked}"

  manifest="${unpacked}/manifest.json"
  [[ -f "${manifest}" ]] || die "no manifest.json in ${bundle}"
  check_schema "$(jq -r '.schema // ""' "${manifest}")"

  [[ -e "${CORPUS_IMAGES}/.git" ]] || err "testdata/images isn't checked out; dedupe covers only the committed images"
  corpus_index >"${index}"
  stage_new "${unpacked}" "${new_dir}" "${index}" "${status_file}"
  generate_goldens "${new_dir}"
  if [[ "${consented}" == 1 ]]; then
    publish_new "${new_dir}"
  fi

  {
    write_summary_header "${manifest}" "${bundle}"
    write_summary_files "${manifest}" "${status_file}"
    write_summary_next "${consented}" "${new_dir}"
  } >"${summary}"
  info "✓  $(grep -c $'\tnew$' "${status_file}" || true) new of $(wc -l <"${status_file}" | tr -d ' ') screenshots; summary in ${summary#"${REPO_ROOT}"/}"
}

main "$@"
