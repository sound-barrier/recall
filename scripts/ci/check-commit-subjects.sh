#!/usr/bin/env bash
# Hold commit subjects to Conventional Commits. release-please reads the prefix
# to pick the next version and write CHANGELOG.md, so a subject it cannot parse
# ships its change as a silent patch, or not at all.
#
# This is the ONE copy of the rule. Two callers, two modes:
#
#   --message-file <path>   lefthook's commit-msg hook, before a commit exists.
#                           Checks the file's first line.
#   <revision range>        CI's commit-lint job, over every non-merge commit a
#                           pull request adds. PRs land by rebase, so each of
#                           those commits reaches main verbatim, and the local
#                           hook alone is bypassed by LEFTHOOK_EXCLUDE or by a
#                           commit written in GitHub's web UI (Copilot Autofix,
#                           "Apply suggestions from code review", Revert).
#
# There are no exemptions for bots or for GitHub-generated subjects: Dependabot,
# release-please and roster-watch already write conforming subjects, and a
# web-UI commit is reworded before it merges.
#
# Exit 0 when every subject conforms, 1 when any does not, 2 on a usage error or
# an unreadable range.
#
# Usage:
#   bash scripts/ci/check-commit-subjects.sh --message-file .git/COMMIT_EDITMSG
#   bash scripts/ci/check-commit-subjects.sh origin/main..HEAD

set -euo pipefail

readonly SUBJECT_PATTERN='^(feat|fix|chore|docs|refactor|test|perf|build|ci|revert|style)(\([a-z0-9_-]+\))?!?: .+'

usage() {
  echo "usage: $0 --message-file <path> | <revision range>" >&2
  exit 2
}

subject_conforms() {
  grep -qE "${SUBJECT_PATTERN}" <<<"$1"
}

print_format_help() {
  echo "Commit subject must follow Conventional Commits format:"
  echo "  <type>(<scope>)?(!)?: <description>"
  echo "  e.g. feat(parser): add Suravasa map alias"
  echo "       fix: rename brand-grey CSS var to brand-gray"
  echo "Allowed types: feat, fix, chore, docs, refactor, test, perf, build, ci, revert, style"
}

check_message_file() {
  local subject=""
  if [[ ! -r "$1" ]]; then
    echo "Cannot read commit message file '$1'" >&2
    return 2
  fi
  IFS= read -r subject <"$1" || true
  subject_conforms "${subject}" && return 0
  print_format_help
  echo "Bypass: LEFTHOOK_EXCLUDE=conventional git commit ... (CI's commit-lint job still checks it)"
  return 1
}

check_range() {
  local commits sha subject misses=0
  if ! commits="$(git rev-list --no-merges "$1")"; then
    echo "::error::Cannot list the commits in range '$1'" >&2
    return 2
  fi
  while IFS= read -r sha; do
    [[ -n "${sha}" ]] || continue
    IFS= read -r subject < <(git log -1 --format=%B "${sha}")
    subject_conforms "${subject}" && continue
    echo "::error::Not a Conventional Commit subject (${sha:0:12}): ${subject}"
    misses=$((misses + 1))
  done <<<"${commits}"
  [[ "${misses}" -eq 0 ]] && return 0
  print_format_help
  echo "Reword the ${misses} commit(s) above (git rebase -i, then reword) and push again."
  return 1
}

case "${1:-}" in
  --message-file)
    [[ $# -eq 2 ]] || usage
    check_message_file "$2"
    ;;
  "" | -*) usage ;;
  *)
    [[ $# -eq 1 ]] || usage
    check_range "$1"
    ;;
esac
