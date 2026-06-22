# Recommendations for 1.0.0

A prioritized, forward-looking action plan for the public **1.0.0** release. This
is the *what-to-change* companion to [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md)
(the *what's-owed-today* ledger); items here link back to debt sections by number
(`→ TD §n`). It also complements the existing `REVIEW.md` Q1–Q18 audit rather than
restating it — where they overlap (migrations, coverage) this doc sharpens the
item with verified live measurements.

## Verdict

**Recall is genuinely 1.0-ready.** The architecture is clean (thin-shell Vue +
Pinia stores, file-per-concern Go packages, pure-Go no-CGo SQLite), the REST and
DB contracts are disciplined, security boundaries are real, and CI is broad
(dual build-tag lint, schemathesis, CodeQL, gosec, govulncheck, cosign-signed
provenance, Playwright + axe). Nothing below blocks a release on *correctness*.

What's left is exactly what a pre-1.0 review should surface: a handful of
**contract decisions that are cheap now and expensive after the freeze**, a few
**integrity/coverage gaps**, and **first-run UX polish** that matters
disproportionately for a cold public audience. Breaking changes are in scope (the
maintainer confirmed) and are flagged per item.

> **Method note.** Every finding was verified against source before landing here.
> A first review pass produced several confident-but-false findings (an
> imagined 2,221-line `App.vue`, a "blocking" `v-for` key bug, a non-existent
> migration, phantom missing constraints). Those are catalogued in
> [§ Verified and dismissed](#verified-and-dismissed) so they aren't re-chased.

## Priority legend

| Tier | Meaning |
|---|---|
| **P0** | Resolve before the 1.0 tag — the contract or its evolution path freezes here. |
| **P1** | High value for launch quality; do it for the Reddit debut. |
| **P2** | Maintainability; schedule shortly after launch. |
| **P3** | Polish; opportunistic. |

`Breaking` = changes the public REST/DB contract or a stored shape. `Effort`:
S ≈ hours, M ≈ a day, L ≈ multi-day.

---

## P0 — before the contract freezes

### R-1 · Activate the schema-migration path · Breaking (dev DBs) · M · → TD §5

The single most important 1.0 item. There is no `PRAGMA user_version` and the
migration runner is inert (`pkg/db/migrate.go` `applyMigrations` is a no-op;
`pkg/db/migrations/` is empty). Right pre-1.0, wrong the instant users have data.

1. Set `PRAGMA user_version` in `NewSQLStore` (`pkg/db/store.go:227-267`).
2. Seed a baseline `0001_init.up.sql` from the current `pkg/db/schema.sql`.
3. Flip `applyMigrations` live so versioned pairs apply on open.

`REVIEW.md` Q18 already tracks "activate migrations post-1.0" — the recommendation
here is to do the **scaffolding + baseline before** the tag so the *first* post-1.0
change is a normal migration, not an emergency. Bundle the two schema changes
below (R-3) into that baseline.

### R-2 · Decide the annotation delete contract · Breaking (if split) · S · → TD §7

`PUT …/annotation` currently deletes the row on an all-empty body
(`pkg/cmd/server_matches_item.go:122-194`). For a public 1.0 API, pick one and
commit before third parties depend on the overload:

- **Recommended:** add explicit `DELETE /api/v1/matches/{match_key}/annotation`;
  make `PUT` upsert-only (reject all-empty with 400). Cleaner verb set, idempotent
  delete, self-describing. Costs one handler + one OpenAPI block + one `api.ts`
  wrapper (the 3-step recipe in `api-design.md`).
- **Minimum:** keep the overload but document it loudly in the OpenAPI
  `description` so it's an intentional contract, not a surprise.

---

## P1 — launch quality

### R-3 · Add a `CHECK` on `rank_modifiers.modifier` · Breaking (schema) · S · → TD §6

Every sibling enum constrains its vocabulary at the DB; `rank_modifiers.modifier`
doesn't (`pkg/db/schema.sql` ~`:160`). Add `CHECK (modifier IN (...))` with the
OW2 modifier set. Land it inside the R-1 baseline so it's not a standalone wipe.

### R-4 · Fix the stale `migrateMatchKeysColonToDash` doc reference · Non-breaking · S · → TD §7

`.claude/rules/api-design.md` documents a startup migration that does not exist.
Delete/correct the sentence (it's a gitignored dev-only rule file, so it never
ships, but it actively misleads match-key work and implies legacy DBs self-heal).

### R-5 · Front-load first-run readiness · Non-breaking · S–M · → TD §9

Replace the two sequential blockers (folder, then Tesseract) in `IngestView.vue`
(`:49-128`) with a single readiness checklist showing **folder ✓/✗** and
**Tesseract ✓/✗** together, each linking to its Settings fix. First-run clarity is
worth more than usual for a cold Reddit audience.

### R-6 · Inline undo for hidden matches · Non-breaking · S · → TD §9

Add an "Undo" toast when a match is hidden, so recovery isn't gated on finding the
archive drawer (`MatchesArchiveDrawer.vue`).

### R-7 · Lift unit coverage off the floor · Non-breaking · S–M · → TD §8

Verified live: frontend branch coverage **61.16%** vs the 60% gate (~1.2 pts of
headroom). Target the thinnest consequential paths first — `stores/settings.ts`
(0% branch), `match/match-table-tsv.ts` (27.58%), then the weak Go packages
`pkg/applog` (29.2%) and `pkg/probe` (57.8%). Sharpens `REVIEW.md` Q17 with current
numbers.

---

## P2 — maintainability

### R-8 · Split the oversized SFCs, `MatchMapRoleBand.vue` first · Non-breaking · L · → TD §4

`TECHNICAL_DEBT.md` §4 already owns this work with a worked method and split list.
The one change from this review: **`MatchMapRoleBand.vue` is now 923 lines** (the
doc recorded 647 and classed it "keep"); it's the largest SFC and should move to
the front of the split queue. Follow §4's behaviour-preserving recipe (template →
child SFC, scoped-style-migration caveat, `task test` + `task test-e2e` per file).

### R-9 · Decide the `screenshots_dirs` cleanup story · Non-breaking · S–M · → TD §6

Pick one: a prune-on-unreferenced routine, `SET NULL` + nullable column, or
"documented permanent." Low urgency (benign), but make the call while the schema
is open so it can ride R-1 if it needs a column change.

---

## P3 — polish

### R-10 · Trim the three Go functions over cyclomatic 15 · Non-breaking · S

`(*App).ExportDataCSV` (17, `pkg/app/export_csv.go:16`), `parsePersonalStatCell`
(17, `pkg/parser/parse_personal.go:181`), `SeedProfile` (16, `pkg/app/seed.go:56`).
Consistent with `TECHNICAL_DEBT.md` §3's stance: only if a real readability/bug
problem surfaces — `parsePersonalStatCell` is dense OCR logic the rules exempt.

### R-11 · Discoverability + magic-number polish · Non-breaking · S · → TD §9

Tooltip/hint for the `MatchesTable` drag-select + `Ctrl/Cmd+C` TSV copy; derive
`SCROLL_STEP_PX` (`MatchDetailPanel.vue:81`) from a measured row height.

### R-12 · Document `ClearMatches` suppress-list semantics · Non-breaking · S · → TD §10

One line in the OpenAPI `ClearMatches` entry noting `all_heroes_screenshots` is
always wiped (benign — re-recognized next parse) even with `keep_ignored=true`.

---

## Bold redesign appendix (breaking — considered, mostly *not* recommended)

The maintainer asked for aggressive options while the contract is open. Here they
are, weighed honestly — a real review says "no" when the status quo is better.

### B-1 · Unified `screenshots` table vs five per-type tables — **recommend KEEP**

The five parent tables (`summary`/`teams`/`personal`/`rank`/`unknown`) could
collapse into one `screenshots` table with a `type` discriminant + typed child
tables. **Don't.** The current design's columns are *meaningfully different per
type* (summary's `perf_*`, teams' E/A/D + damage/healing, rank's
rank/level/progress, personal's hero-only, unknown's none); a unified table would
be wide and sparse with type-conditional NULLs — strictly worse for integrity and
clarity. The per-type split also enables the EAD-signature bridge
(`resolveMatchKey`) cleanly. This is good 3NF modeling; leave it.

### B-2 · Structured JSON error bodies (RFC 9457 `problem+json`) — **optional, defer**

The API returns plain-text errors (`http.Error`), deliberately deferred in
`api-design.md` "until a real machine-parsing need." For a public API a third
party scripts against, machine-parseable error bodies (`type`/`title`/`detail`)
are a cleaner 1.0 contract — but adding them speculatively is the exact YAGNI the
project avoids. Recommendation: **don't add it for 1.0**; if/when an integrator
asks, add it under `/api/v2` rather than mutating v1. Noted here only so the
trade-off is on record.

### B-3 · `match_key` embeds filenames for unmatched/ambiguous — **recommend KEEP**

`unmatched-<filename>` / `ambiguous-<filename>` couple identity to a filename,
nominally against "match key is identity, never key on filename." But these are
the explicit pre-resolution sentinels (a real `match-<ts>` key is minted on
resolution), they're URL-safe, and the coupling is transient. Not worth churn.

---

## Verified and dismissed

Raised by an automated review pass; **each checked against source and false** —
do not re-open:

| Claim | Reality |
|---|---|
| `App.vue` is ~2,221 LOC / a god-shell | **168 lines** — clean thin shell per `frontend/CLAUDE.md`. |
| 15 `v-for` missing `:key` (HIGH blocking) | Same-line grep artifact; keys are present (`SettingsProfiles.vue:92`, `ParseProgressPanel.vue:165`, `PivotCrosstab.vue:68`). Vue rules + `vue-tsc` would block a real miss. |
| Hard-delete 204-vs-404 drift | None. OpenAPI `delete` block (`openapi.yaml:234-240`) is 204/400/500; the `:215` 404 is `GetMatchByKey`'s, which correctly 404s. |
| `POST /matches` lacks roster validation | `CreateManualMatch` validates → `ErrUnknownMap`/`ErrUnknownHero` (409) (`pkg/app/usermatch.go:52-56,144`). |
| Missing enum `CHECK` constraints | Present on `leaver`/`reviewed_by`/`queue_type`/`play_mode`/`result`. Only `rank_modifiers` lacks one (R-3). |
| `screenshots_dir` RESTRICT is "too protective" | Deliberate, documented invariant; real gap is just the missing GC path (R-9). |

## What's already excellent — don't "fix" it

So cleanup doesn't erode strengths:

- **Architecture** — `App.vue` 168 lines, zero business logic; Pinia domain
  stores; the `@/api-client` `setApiBacking()` test seam; feature-folder layout.
- **DB** — 3NF with justified denormalization, composite child PKs,
  CASCADE/RESTRICT enforced via `PRAGMA foreign_keys = ON`, enum `CHECK`s, the
  `screenshots_dirs` sentinel-row pattern, read-time aggregation (no N+1).
- **REST** — `/api/v1` versioning, noun resources, correct 201/202/204, cursor
  pagination, typed-sentinel → 4xx mapping, native 405 via the dedicated `apiMux`.
- **Security** — `safePathChars` + `filepath.Clean` boundary validators CodeQL
  recognizes as sanitizers; pure-Go SQLite (no CGo) — load-bearing for releases.
- **CI/CD** — dual build-tag lint, schemathesis fuzz, CodeQL, gosec, govulncheck,
  bundle-size budget, cosign-signed provenance, Playwright + axe a11y.

---

## Suggested sequencing

1. **Before the tag:** R-1 (+ R-3 in its baseline), R-2, R-4.
2. **Launch week:** R-5, R-6, R-7.
3. **Post-launch:** R-8, R-9, then the P3 polish.

## Validating this document

Every finding carries a real `file:line` you can open. Quantitative claims are
reproducible: `wc -l <file>` for sizes, `gocyclo -over 15 ./pkg/...` for
complexity, `task cover` for the coverage numbers, and the cited handler/schema
lines for the contract claims.
