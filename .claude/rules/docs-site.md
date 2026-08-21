---
paths:
  - "docs/**"
  - "book/**"
  - "*.md"
---

# Documentation site (Honkit + Swagger UI)

## Documentation audiences

| File(s) | Audience | Notes |
|---|---|---|
| `README.md`, `docs/install-windows.md` | Gamers | Quick start + install. Keep jargon out. |
| `docs/how-it-works.md` | Gamers | Pipeline overview + workflow + the four screenshot types. Anchors the book's "Using Recall" section. |
| `docs/settings-reference.md` | Gamers | Every Settings + Parse tab field. Source of truth for "what does this knob do?". |
| `docs/filtering.md` | Gamers | Matches tab filter rail end-to-end. |
| `docs/unknown-screenshots.md` | Gamers | Unknown tab triage: 4 causes + diagnostic strip + recovery paths. |
| `docs/feedback.md` | Gamers | Bug/feature pointer to `.github/ISSUE_TEMPLATE/*.yml` + security-advisory channel. |
| `docs/faq.md` | Gamers | Standing questions that keep arriving through feedback. |
| `docs/reading-your-climb.md` | Gamers | How to read the Elo/standing surfaces without over-reading them. |
| `docs/reviews.md` | Gamers + coaches | The 07 Reviews cycle: sittings, the film room, sending to a coach. |
| `docs/seasons-comparison-design.md` | Developers | Why the Compare tab computes seasons the way it does. |
| `CONTRIBUTING.md`, `RELEASES.md` | Developers | Build, lint, release, commit-message rules. |
| `CODE_OF_CONDUCT.md` | Repo participants | Two rules: be respectful, project is free with no SLAs. ~50 lines. |
| `SECURITY.md` | Security reporters | Latest-release-only support; file via GitHub Security Advisories (private), no SLA. |
| `.github/ISSUE_TEMPLATE/*.yml` + `pull_request_template.md` | Issue/PR authors | YAML Issue Forms; PR template carries commit-style + TDD + docs checklist. |
| `.github/CODEOWNERS` | PR routing | Catch-all `* @jacob-delgado`. Last-matching-rule-wins. |
| `.github/labels.yml` | Triagers | Declarative label defs synced by `labels.yml` workflow. |

Load-bearing cross-doc anchors:
`docs/install-windows.md#verifying-your-download`,
`CONTRIBUTING.md#building`, `CONTRIBUTING.md#pre-commit-hooks-lefthook`. Rename a
heading and you'll silently break the inbound link.

## `docs/` is the source of truth; `book/` is metadata only

The Honkit-built site at <https://sound-barrier.github.io/recall/> renders
`docs/*.md` chapters. The Pages workflow + `task pages-build` stage `book/` +
chapter copies into `_stage/book/` (CI) or `dist/pages-stage/` (local) and run
Honkit there. `book/` keeps only `book.json`, `SUMMARY.md`, `README.md`,
`.gitignore`. **New chapter**: drop `.md` into `docs/`, add to `book/SUMMARY.md`,
extend the `cp` step in both `pages.yml` and the `pages-build` task.

## Honkit failure modes

- **Honkit fails silently in two ways producing a 1-page book.** (1) Reads
  `.gitignore` from its source dir and drops matching files (chapter filenames in
  `book/.gitignore` makes them all vanish). (2) Resolves `SUMMARY.md` paths
  relative to `cwd`, not the source arg — `npx honkit build book book/_book` from
  repo root parses SUMMARY but can't find chapters. Both surface as `info: found 1
  pages`. The staging-dir workaround sidesteps both.
- **Honkit asset-copies any non-markdown file in its source dir** while preserving
  paths. To embed images in a chapter, drop them into a subdir under the staging
  dir — `pages-build` + `pages.yml` already do `mkdir -p _stage/book/testdata && cp
  testdata/*.png _stage/book/testdata/`. Reference as `testdata/foo.png` — same
  path works in GitHub-rendered markdown. New asset-bearing chapter: add `mkdir
  -p` + `cp` to both `pages.yml` and `Taskfile.yml`, plus the `paths:` trigger if
  outside `docs/`/`book/`.

## Markdown authoring (markdownlint)

- **Multi-line code in CLAUDE.md / markdown bullets trips MD031.** A fenced block
  indented under `-` violates "fenced code blocks should be surrounded by blank
  lines"; adding blanks breaks the bullet continuation. Inline as a single
  backtick string instead — long lines are fine, no line-length rule in this repo.
- **Headings with em-dashes / non-ASCII trip MD051.** Honkit's slugifier
  preserves the dash; MD051's validator strips it, so in-doc `[label](#fragment)`
  links break. Reference sections by name ("see section 3 below") instead of
  fragment-linking.

## TECHNICAL_DEBT.md

Delete-when-paid, not strikethrough-when-paid. Header says "delete the section —
git history is the audit trail." No `Phase N ✅ COMPLETE` subsections, no
`~~item~~` lines — delete closed items. Item numbers stay stable (gaps fine;
never renumber).
