#!/usr/bin/env bash
# Open or update the roster-watch draft PR.
#
# Called by .github/workflows/roster-watch.yml after the tool has written its
# proposed entries. Uses git + gh rather than a third-party pull-request action:
# scripts/release/push-release-tag.sh already establishes the bot identity and
# the gh idiom here, and a PR this consequential should be openable by reading
# one shell script rather than auditing an action.
#
# Idempotent by construction. The branch is fixed and force-updated, so a second
# Thursday refreshes one pull request instead of opening a second — and a run
# that finds nothing new leaves the branch exactly as it was.
#
# Inputs (env):
#   REPORT_FILE  path to the Markdown report the tool produced
#   GOLDEN_FILE  path to the golden-corpus result, or unset when it did not run
#   GH_TOKEN     for gh
set -euo pipefail

BRANCH="chore/roster-watch"
REPORT_FILE="${REPORT_FILE:?REPORT_FILE is required}"

if git diff --quiet; then
  echo "[ roster-watch ] the tool proposed no file changes — nothing to open"
  exit 0
fi

# The identity every bot commit in this repo carries.
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git checkout -B "${BRANCH}"
git add pkg/parser
git commit -m "feat(parser): roster entries proposed by the Thursday watch

Every entry here is UNCONFIRMED. The spelling came from Blizzard's own
page, not from a scoreboard, and not from parser output. Confirm each one
against a real scoreboard before merging, add its guard test, and read
the golden-corpus result in the pull request body.

This commit is a draft written by .github/workflows/roster-watch.yml."

git push --force origin "${BRANCH}"

body="$(mktemp)"
{
  echo "Opened by the Thursday roster watch. **Draft on purpose** — the entries"
  echo "below are proposals, not decisions."
  echo
  cat "${REPORT_FILE}"
  echo
  if [[ -n "${GOLDEN_FILE:-}" && -f "${GOLDEN_FILE}" ]]; then
    echo "### Golden corpus, against these entries"
    echo
    echo '```'
    cat "${GOLDEN_FILE}"
    echo '```'
    echo
  fi
  cat <<'CHECKLIST'
### Before this can merge

- [ ] Confirm every spelling against a real scoreboard. Blizzard's page is a
      good candidate; the font OCR actually reads is the truth. `maps.yaml`
      carried "Neon Function" for seven weeks because that step was skipped.
- [ ] Add a `TestRoster_Recognizes<Name>` for each new entry, and a collision
      test if the name is short or shares a prefix with an existing one — D.Mon
      needed one against D.Va.
- [ ] Update the doc counts: `FEATURES.md`, `docs/dev-reference.md`,
      `docs/filtering.md`, and `NarrowPopover.vue`.
- [ ] Drop the unconfirmed comment once a real match has parsed on it.

Pushing your own commit to this branch is what brings full CI: a pull request
opened by the Actions token gets none, which is why the golden corpus ran in
the job above rather than waiting for a check that never arrives.
CHECKLIST
} >"${body}"

if gh pr view "${BRANCH}" --json number >/dev/null 2>&1; then
  echo "[ roster-watch ] updating the open pull request"
  gh pr edit "${BRANCH}" --body-file "${body}"
else
  echo "[ roster-watch ] opening a draft pull request"
  gh pr create --draft --base main --head "${BRANCH}" \
    --title "feat(parser): roster drift found by the Thursday watch" \
    --body-file "${body}"
fi
