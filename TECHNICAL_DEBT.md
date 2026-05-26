# Technical Debt

Living inventory of known technical debt in the Recall codebase. Each
item has the same four-section shape so they can be triaged, scoped,
and worked off independently. Update this file whenever debt is added
(record it the same week, with the same rigor) or paid down (delete
the section — not "strikethrough", not "✅", just delete it; git
history is the audit trail).

## How to read this file

Each item carries a **size** estimate that combines coding effort with
review/test/release surface area:

| Size | Rough effort | Examples |
|---|---|---|
| **S**  | < 2 hours | A single-file rename, one Makefile var, one config flip. |
| **M**  | ½–2 days | A refactor inside one package; new test file; small DI seam. |
| **L**  | 2–5 days | Multi-package refactor; new abstraction with migrations; CI rewiring. |
| **XL** | 1–2 weeks | Rewriting a monolith; introducing a new runtime dependency; reshaping an entire layer. |

A **plan** is a sequence of *small, independently mergeable* steps. If
a step needs a release or a contributor handoff, that's marked in line.
Anything that has to land atomically is called out.

The list is ordered by *risk × cost-to-fix-later*, not by size. The
top items are the ones most likely to bite if left alone. Pay them off
first.

---

## 1. PERSONAL stat keys carry OCR garble in the DB

**What**: PERSONAL-tab per-card stat names go through `labelToKey()` and land in `personal_hero_stats.stat_key` verbatim. Tesseract mangles some labels even after the icon-stripped second pass — Juno's "ORBITAL RAY ASSISTS" has shown up as `ooorsitall_ray_assists` in production goldens (visible in `testdata/Overwatch 2 Screenshot 2026.05.24 - 22.36.34.50.png.golden.json`).

**Why**: Two ways this bites:

1. Cross-match inconsistency — the same hero's "orbital ray assists" can land under multiple keys depending on OCR luck. Per-stat aggregation across a player's match history is unreliable.
2. The UI surfaces these mangled keys to the user. "Players Saved: 5" reads fine; "Ooorsitall Ray Assists: 2" does not.

**Plan**:

1. Build a canonical stat-key list per hero (YAML, similar to `heroes.yaml` / `maps.yaml`). Embed at `pkg/parser/hero_stats.yaml`.
2. After `labelToKey()` produces the raw snake_case, snap it to the nearest canonical key for that hero via Levenshtein (the matcher already exists for map names in `pkg/parser/maps.go::bestKnownMapInText`).
3. Re-baseline `testdata/*.golden.json` to confirm canonical keys replace OCR garble.

**Size**: M.

## 2. Legacy `match_results` table is not dropped on first launch after PR #45

**What**: PR #45 cut over to the 10-table 3NF schema with no migration. `pkg/db/db.go::NewSQLStore` runs `CREATE TABLE IF NOT EXISTS` for the new tables but never drops the old `match_results` table, so existing installs end up with the legacy table sitting orphaned alongside the new ones forever.

**Why**:

1. `sqlite3 recall.db ".tables"` shows a stale `match_results` that nothing reads or writes, which confuses anyone inspecting their DB.
2. Disk space — a populated legacy `match_results` keeps the user's whole pre-#45 match history (which is invisible to the new code path).
3. The dev scripts (`clear-db.sh`, `verify-stack.sh`) carry legacy-detection branches that exist purely because the migration is incomplete; the branches can go away once the cleanup is automatic.

**Plan**:

1. Append `DROP TABLE IF EXISTS match_results` to `schemaStatements` in `pkg/db/db.go` (idempotent — no-ops on fresh installs).
2. Log a one-line breadcrumb the first time the drop fires so users have visibility (`log.Printf("dropped legacy match_results table (pre-PR-#45 schema)")` — only if the table was actually present).
3. After a release or two, delete the legacy-schema-detection branches in `scripts/clear-db.sh` and `scripts/verify-stack.sh`.

**Size**: S.

## 3. Golden-file comparison is sensitive to Tesseract version drift

**What**: `TestParseScreenshot_GoldenFiles` compares parser output to the committed sidecars via `bytes.Equal` on `json.MarshalIndent` output. A single-character OCR difference between dev and CI Tesseract versions trips the test even when the parser logic is unchanged. `testdata/README.md` already documents the recommended response ("re-baseline the sidecars") but treats it as a contributor workflow, not a CI gate.

**Why**: Every Tesseract bump (system update, devcontainer rebuild, GitHub runner image refresh) risks tripping CI without anyone touching the parser. Currently survives because dev + CI happen to be on the same major.minor — that alignment is accidental. The fragility grows the more goldens land.

**Plan** (cheapest first):

1. Pin Tesseract in CI via apt + a fixed version in `.devcontainer/postCreate.sh` and the GitHub workflow's setup step. Add the pin to `tool-versions.env` so `make check-deps` tracks the upstream.
2. Optional follow-on: replace `bytes.Equal` with a fuzzy comparator (Levenshtein on string fields, exact on numerics) so a one-character OCR jitter doesn't fail the test but a real regression does. Higher cost; defer until pin #1 proves insufficient.

**Size**: S for the pin; M if the fuzzy comparator becomes necessary.

---

## Prioritized roadmap

By risk × cost-to-fix-later, top-first:

1. [#1 — PERSONAL stat keys carry OCR garble](#1-personal-stat-keys-carry-ocr-garble-in-the-db) — active data pollution, gets worse with every parse.
2. [#2 — Legacy `match_results` not dropped](#2-legacy-match_results-table-is-not-dropped-on-first-launch-after-pr-45) — small fix, removes confusion + scripts cleanup.
3. [#3 — Tesseract drift fragility](#3-golden-file-comparison-is-sensitive-to-tesseract-version-drift) — silent until it bites; pin is cheap insurance.

When an item lands, **delete its section** — not "strikethrough", not "✅", just delete. Item numbers stay stable across deletions (gaps are fine; never renumber). Git history is the audit trail.
