<!--
  Thanks for sending a PR. Fill out the sections below — empty or
  unchecked items will hold up the review.
-->

## Summary

<!-- 1–3 sentences: what changes, and why. -->

## Related issue

<!-- "Fixes #N" (closes the issue on merge), "Refs #N", or "n/a". -->

## Test plan

<!-- How did you verify this works? Tests added? Manual steps? -->

- [ ]

## Notes for reviewer

<!-- Anything specific you'd like a second opinion on, or that's
     non-obvious from the diff. Optional. -->

---

## Checklist

- [ ] **Commits are small and logical** — one logical change per commit.
- [ ] **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) plus the [Linux kernel commit guidelines](https://www.kernel.org/doc/html/latest/process/submitting-patches.html#describe-your-changes)** — subject ≤ 72 chars in imperative mood, body wrapped at 72 explaining *why* not *what*. Full rules and examples: [CONTRIBUTING.md → Git hooks (lefthook)](CONTRIBUTING.md#git-hooks-lefthook).
- [ ] **Tests added or updated where appropriate.** TDD is the expectation for new features and bug fixes (see [CLAUDE.md → Working style → TDD process](CLAUDE.md#tdd-process)).
- [ ] **Documentation updated where appropriate** — CLAUDE.md if you changed an architectural pattern, README/docs if you changed user-visible behavior, CODE_OF_CONDUCT.md if you changed how the project is governed.
- [ ] **CI is green** — lint, tests, typecheck, coverage thresholds, schemathesis. The repo's [CI workflows](.github/workflows/) gate merges.
