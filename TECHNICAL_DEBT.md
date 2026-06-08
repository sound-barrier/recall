# Technical Debt

Living inventory of known technical debt in the Recall codebase. Each
item has the same five-section shape so they can be triaged, scoped,
and worked off independently. Update this file whenever debt is added
(record it the same week, with the same rigor) or paid down (delete
the section — not "strikethrough", not "✅", just delete it; git
history is the audit trail).

## How to read this file

Each item carries two estimates — **size** (coding effort + review
surface) and **risk** (what could break) — so triage can favour
items with low cost AND low blast radius first.

| Size | Rough effort | Examples |
|---|---|---|
| **S**  | < 2 hours | A single-file rename, one Makefile var, one config flip. |
| **M**  | ½–2 days | A refactor inside one package; new test file; small DI seam. |
| **L**  | 2–5 days | Multi-package refactor; new abstraction with migrations; CI rewiring. |
| **XL** | 1–2 weeks | Rewriting a monolith; introducing a new runtime dependency; reshaping an entire layer. |

| Risk | What "breaks" means here |
|---|---|
| **Low**  | Local refactor; if it slips, the diff is small and lint/test catch it. |
| **Med**  | Touches multiple layers or a shared abstraction; CI may not catch everything; needs careful staging or a feature flag. |
| **High** | SQLite schema, on-disk format, public URL shape, or build-tag-conditioned behaviour. Mistakes can corrupt user data or strand existing installs. |

A **plan** is a sequence of *small, independently mergeable* steps.
If a step needs a release or a contributor handoff, that's marked in
line. Anything that has to land atomically is called out.

The list is ordered by *risk × cost-to-fix-later*, not by size. The
top items are the ones most likely to bite if left alone. Pay them
off first.

## How to add a new entry

When you find debt, capture it the same week with the same shape:

```markdown
## N. Short headline — what's broken in one phrase

**Where:** file:line + a sentence explaining the surface area.

**What breaks:** one paragraph; concrete user-visible or
contributor-visible failure mode. Avoid "this is ugly" framings —
articulate the cost.

**Plan:** numbered steps that are independently mergeable.

**Size:** S/M/L/XL.
**Risk:** Low/Med/High.
```

Keep the numbering stable across edits — gaps in the sequence are
fine, never renumber. When a section is paid down in full,
*delete* it; the git log is the audit trail.

## 3. `parseFilenameTimestamp` format list could absorb a fourth source without a code change

**Where:** `pkg/app/correlation.go:39` — the `filenameFormats`
slice is a hard-coded var with three records (Nvidia / PrntScn /
Snip). PR #227 leaves a TODO for Steam's F12 capture format which
hasn't been sampled yet.

**What breaks:** when the user gathers Steam samples, adding a
fourth entry requires touching Go code + cutting a release. A
yaml sidecar with the same three records would let the maintainer
ship "new capture tool support" as a YAML update instead of a
binary release — same pattern as `heroes.yaml` + `maps.yaml`.

**Plan:**

1. Move `filenameFormats` into a `pkg/parser/screenshot_sources.yaml`
   keyed by tool name, with `prefix`, `regex`, `year_offset`
   fields.
2. Load at init() (mirror `owdata.go`'s yaml-load pattern).
3. Ship the YAML alongside `heroes.yaml` + `maps.yaml` as an
   attested release asset so users can verify it.
4. Add a Settings → Advanced "Reload capture-source rules" button
   that re-reads the YAML at runtime (optional — lets power users
   prototype new patterns without a release).

**Size:** M.
**Risk:** Med — the regex isn't user-input but a bad pattern
could match unrelated files. Defensive: keep the prefix gate;
reject patterns without a leading `^`-anchor.

## 4. Settings empty-hero auto-detection has two probe endpoints

**Where:** `pkg/app/probe.go` exposes both `ProbeScreenshotsDir`
(single-best-path, used by the steady-state "Detect" button) and
`ProbeScreenshotsCandidates` (four-card list, used by the
first-run picker). The two share `dirExists` + `candidateSources`
under the hood but expose two separate HTTP endpoints.

**What breaks:** documentation drift (the steady-state Detect
button still uses the old endpoint shape; the first-run picker
uses the new). A maintainer touching one path easily forgets the
other; the new candidate list is the strict superset of the
single-best probe so the old endpoint is redundant.

**Plan:**

1. Mark `ProbeScreenshotsDir` deprecated in the OpenAPI spec
   (`deprecated: true`); keep returning the first found
   candidate's path so existing callers don't break.
2. Move the steady-state Detect button to consume
   `screenshots-folder-candidates`, picking the first
   `exists: true` entry.
3. Delete the old endpoint in a future pre-1.0 minor bump
   (`feat!:` with `BREAKING CHANGE:` footer).

**Size:** S.
**Risk:** Low — both endpoints are internal-only; the frontend is
the only consumer.
