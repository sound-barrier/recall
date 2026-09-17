#!/usr/bin/env bash
# Fail when a ci.yml job is missing from ci-gate's needs.
#
# Branch protection requires ci-gate, not the individual ci.yml jobs, so a job
# gates merges only while ci-gate needs it. A job left out of that list still
# runs and still turns red, and the PR merges anyway. Nothing else notices: the
# run page shows the red job, but the merge button does not.
#
# awk, not a YAML parser, so the check needs no tool the lint job lacks. That
# fixes the shapes it accepts, which are the ones ci.yml uses: bare job ids
# indented two spaces under `jobs:` (`  <job>:`), and ci-gate's needs as a block
# list (`needs:`, then one `- <job>` per line). Any other shape, a quoted or
# anchored job key included, is reported, never guessed at.
#
# Exempt: ci-gate itself, and branch-coverage, which is report-only
# (continue-on-error) and must never gate a merge.
#
# Reads the workflow in one pass, so a process substitution works:
#   bash scripts/ci/check-ci-gate-needs.sh <(git show main:.github/workflows/ci.yml)
#
# Usage: bash scripts/ci/check-ci-gate-needs.sh [workflow file]

set -euo pipefail

readonly GATE_JOB="ci-gate"
readonly EXEMPT_JOBS="ci-gate branch-coverage"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow="${1:-${REPO_ROOT}/.github/workflows/ci.yml}"

awk -v gate="${GATE_JOB}" -v exempt="${EXEMPT_JOBS}" '
  BEGIN {
    split(exempt, exempt_list, " ")
    for (i in exempt_list) is_exempt[exempt_list[i]] = 1
  }

  /^[[:space:]]*(#.*)?$/ { next }

  /^jobs:[[:space:]]*(#.*)?$/ { in_jobs = 1; next }
  /^[^[:space:]]/ { in_jobs = 0; next }
  !in_jobs { next }

  /^  [A-Za-z0-9_-]+:[[:space:]]*(#.*)?$/ {
    job = $1
    sub(/:.*/, "", job)
    jobs[++job_count] = job
    in_gate = (job == gate)
    if (in_gate) gate_found = 1
    in_needs = 0
    next
  }
  /^  [^[:space:]]/ {
    printf "::error::ci.yml job key not recognized: \047%s\047. Write it bare (  <job>:) so it can be checked against ci-gate needs.\n", $0
    unrecognized_key = 1
    in_gate = 0
    in_needs = 0
    next
  }
  !in_gate { next }

  /^    needs:/ {
    if ($0 !~ /^    needs:[[:space:]]*(#.*)?$/) not_block_list = 1
    in_needs = 1
    next
  }
  in_needs && /^      - [A-Za-z0-9_-]+[[:space:]]*(#.*)?$/ {
    needed[$2] = 1
    need_count++
    next
  }
  /^    [^[:space:]]/ { in_needs = 0 }

  END {
    if (!gate_found) {
      print "::error::ci-gate job not found. Branch protection requires it, so every ci.yml job must feed it."
      exit 1
    }
    if (not_block_list || need_count == 0) {
      print "::error::ci-gate needs must be a non-empty block list (needs:, then one \"- <job>\" per line)."
      exit 1
    }
    missing = 0
    for (i = 1; i <= job_count; i++) {
      if ((jobs[i] in is_exempt) || (jobs[i] in needed)) continue
      printf "::error::ci.yml job \047%s\047 is not in ci-gate needs, so it can fail and the PR still merges\n", jobs[i]
      missing++
    }
    if (missing > 0 || unrecognized_key) exit 1
    printf "ci-gate needs all %d gated ci.yml jobs (exempt: %s).\n", need_count, exempt
  }
' "${workflow}"
