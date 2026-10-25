#!/usr/bin/env bash
# scripts/ci/triage-parse-report.sh — read the report attached to a
# parse-problem issue and write the triage comment and labels for it.
#
# Run by .github/workflows/parse-report-triage.yml in a job that holds no
# write token: everything here comes from the issue (its body, the zip it
# links), so it is untrusted. The zip is never unpacked to disk — the
# manifest is read through a size cap and each screenshot is only hashed.
#
# Usage:
#   ISSUE_BODY=… CORPUS_DIRS=<dir>[:<dir>…] \
#     scripts/ci/triage-parse-report.sh <out-dir>
#
# CORPUS_DIRS lists the folders whose images count as already in the corpus:
# the recall-testdata checkout and recall's own testdata/.
#
# Writes:
#   <out-dir>/comment.md   the triage comment
#   <out-dir>/labels.txt   one label to add per line (may be empty)
#   <out-dir>/has-report   present when a readable report was found
set -euo pipefail

readonly MAX_REPORT_BYTES=26214400 # GitHub's attachment cap is 25 MB
readonly MAX_MANIFEST_BYTES=2097152
readonly MARKER='<!-- parse-report-triage -->'
readonly ATTACHMENT_RE='https://github\.com/user-attachments/files/[0-9]+/[A-Za-z0-9._-]+\.zip'
# Causes that are about the reporter's install or capture rather than the
# parser; any of them earns the setup-issue label.
readonly SETUP_CAUSES='["tesseract_missing","tesseract_unsupported","tesseract_no_english","unusual_aspect_ratio"]'

err() {
  echo "[ triage-parse-report ] $*" >&2
}

sha256_stream() {
  sha256sum | cut -d' ' -f1
}

corpus_index() {
  local dirs dir img
  IFS=: read -ra dirs <<<"${CORPUS_DIRS:-}"
  for dir in "${dirs[@]}"; do
    for img in "${dir}"/*; do
      case "${img}" in
        *.png | *.jpg | *.jpeg) echo "$(sha256_stream <"${img}") $(basename "${img}")" ;;
      esac
    done
  done
}

write_missing() {
  local out="$1" why="$2"
  {
    echo "${MARKER}"
    echo "**No readable report yet.** ${why}"
    echo
    echo "In Recall, click **Report parse problem…**, save the report, and drag the"
    echo "\`recall-diagnostic-….zip\` into this issue. This comment updates when you do."
  } >"${out}/comment.md"
  echo report-missing >"${out}/labels.txt"
}

fetch_report() {
  local url="$1" zip="$2"
  curl -fsSL --proto '=https' --proto-redir '=https' --max-filesize "${MAX_REPORT_BYTES}" \
    --retry 2 -o "${zip}" "${url}"
}

read_manifest() {
  local zip="$1" manifest="$2"
  unzip -p "${zip}" manifest.json 2>/dev/null | head -c "${MAX_MANIFEST_BYTES}" >"${manifest}" || true
  jq -e '.schema | test("^recall-(diagnostic/v[23]|bundle/v1)$")' "${manifest}" >/dev/null 2>&1
}

# screenshot_status prints "<name>\t<status>" for every screenshot in the zip.
screenshot_status() {
  local zip="$1" index="$2" entry hash known
  while IFS= read -r entry; do
    [[ "${entry}" == screenshots/?* && "${entry}" != */ ]] || continue
    hash="$(unzip -p "${zip}" "${entry}" | sha256_stream)"
    known="$(grep -m1 "^${hash} " "${index}" | cut -d' ' -f2- || true)"
    if [[ -n "${known}" ]]; then
      printf "%s\tknown (\`%s\`)\n" "${entry#screenshots/}" "${known}"
    else
      printf '%s\tnew\n' "${entry#screenshots/}"
    fi
  done < <(unzip -Z1 "${zip}")
}

consent_line() {
  if grep -qiE '^- \[x\] OK to add these screenshots to the public test corpus' <<<"${ISSUE_BODY}"; then
    echo "yes: \`task import-report BUNDLE=<zip> CONSENTED=1\` may add the new ones"
  else
    echo "no: keep these screenshots out of recall-testdata"
  fi
}

# Reporter text lands in a bot comment, so each cell is flattened to one
# line, has its pipes escaped, and gets a zero-width space after every @ so
# a note can't mention anyone.
write_summary() {
  local out="$1" manifest="$2" status_file="$3"
  {
    echo "${MARKER}"
    jq -r --arg consent "$(consent_line)" '
      def cell: tostring | gsub("[\n\r]"; " ") | gsub("\\|"; "\\|") | gsub("@"; "@\u200b") | .[0:200];
      "**Parse report read.** `\(.schema | cell)`, Recall \(.recall_version // "unknown" | cell)" +
        (if .environment then ", \(.environment.os | cell), Tesseract \(.environment.tesseract_version // "not found" | cell)" else "" end) + ".",
      "",
      "Corpus consent: \($consent).",
      "",
      (if .schema == "recall-bundle/v1" then "This is an export bundle, not a parse report, so it carries no notes or traces. Asking for **Report parse problem…** gets both.\n" else empty end),
      (if (.likely_causes // []) | length > 0 then
        "**Likely causes the report found:**\n" +
        ([.likely_causes[] | "- `\(.code | cell)`\(if .filename then " (\(.filename | cell))" else "" end): \(.message | cell)"] | join("\n")) + "\n"
       else empty end)
    ' "${manifest}"
    echo "| Screenshot | Corpus | Reporter's note |"
    echo "|---|---|---|"
    local name status
    while IFS=$'\t' read -r name status; do
      jq -r --arg name "${name}" --arg status "${status}" '
        def cell: tostring | gsub("[\n\r]"; " ") | gsub("\\|"; "\\|") | gsub("@"; "@\u200b") | .[0:300];
        ((.files // []) | map(select(.filename == $name)) | first) as $f
        | "| `\($name | cell)` | \($status) | \($f.note // "" | cell) |"
      ' "${manifest}"
    done <"${status_file}"
  } >"${out}/comment.md"
}

write_labels() {
  local out="$1" manifest="$2" status_file="$3"
  : >"${out}/labels.txt"
  if jq -e --argjson setup "${SETUP_CAUSES}" '[(.likely_causes // [])[].code] | any(. as $c | $setup | index($c))' "${manifest}" >/dev/null; then
    echo setup-issue >>"${out}/labels.txt"
  fi
  if [[ -s "${status_file}" ]] && ! grep -q $'\tnew$' "${status_file}"; then
    echo known-screenshot >>"${out}/labels.txt"
  fi
}

main() {
  [[ $# -eq 1 ]] || {
    err "usage: triage-parse-report.sh <out-dir>"
    exit 2
  }
  local out="$1" work url
  mkdir -p "${out}"
  work="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand work now so the trap removes this dir.
  trap "rm -rf '${work}'" EXIT

  url="$(grep -oE "${ATTACHMENT_RE}" <<<"${ISSUE_BODY:-}" | head -1 || true)"
  if [[ -z "${url}" ]]; then
    write_missing "${out}" "This issue has no \`.zip\` attached."
    return
  fi
  if ! fetch_report "${url}" "${work}/report.zip"; then
    write_missing "${out}" "The attached \`.zip\` couldn't be downloaded (over 25 MB, or gone)."
    return
  fi
  if ! read_manifest "${work}/report.zip" "${work}/manifest.json"; then
    write_missing "${out}" "The attached \`.zip\` isn't a Recall report."
    return
  fi

  corpus_index >"${work}/corpus.sha256"
  screenshot_status "${work}/report.zip" "${work}/corpus.sha256" >"${work}/status.tsv"
  write_summary "${out}" "${work}/manifest.json" "${work}/status.tsv"
  write_labels "${out}" "${work}/manifest.json" "${work}/status.tsv"
  echo yes >"${out}/has-report"
}

main "$@"
