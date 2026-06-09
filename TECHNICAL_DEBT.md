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

---

## 1. `data` + `main` mis-marked as required on `/api/v1/system/update`

**Where:** `api/openapi.yaml:1399` — `required: [checked, dev_build,
available, latest, url, data, main]` on the `GET /api/v1/system/update`
response.

**What breaks:** The spec body explicitly documents both fields as
conditional — `data` is unpopulated on the dev-build branch, `main`
is unpopulated when GitHub Pages is unreachable. Today the Go side
populates both with zero values so schemathesis's
`response_schema_conformance` check passes, but any FE that strictly
validates against the schema (or a non-Go consumer hitting the
server-mode REST API) would reject `data: {}` / `main: {}` responses
that are semantically fine. The constraint also misleads anyone
reading the spec — the fields LOOK contractually required.

**Plan:**

1. Drop `data` and `main` from the `required` array on the response
   schema.
2. Update each field's `description` to spell out the "empty when X"
   semantics (already done for `main`; tighten `data` to match).
3. Regenerate `frontend/src/api.gen.d.ts` via `make gen-types` and
   confirm the FE's UpdateInfo type now marks the two fields as
   optional (the SFC already treats them defensively, so no template
   churn expected).
4. Re-run `make check-api-drift` to confirm schemathesis stays
   green.

**Size:** S.
**Risk:** Low — Go serializer still emits the field; both Wails and
server-mode FEs see the same on-the-wire shape.

## 2. `DataStatus` + `MainStatus` schema duplication

**Where:** `api/openapi.yaml:2138-2219` — the two schemas share 6 of
8 fields (`added_heroes`/`removed_heroes` across `heroes`/`maps`/
`sources`, plus `applied_at` and `has_update`). Only the identifier
fields differ (`applied_tag` versus `applied_commit` and
`commit_sha`). The Go side already shares the diff logic —
`pkg/app/update.go::diffRosters` is called from both
`computeDataStatusWithFetched` and `computeMainStatus`.

**What breaks:** A future field added to one schema (a new diff
category, an `applied_by` audit field, etc.) silently drifts from
the other. The duplication also doubles the surface a reader has to
scan to understand the contract.

**Plan:**

1. Add a `RosterDiff` base schema with the six shared fields.
2. Rewrite `DataStatus` and `MainStatus` as `allOf` extending
   `RosterDiff` with their channel-specific identifier fields.
3. Run `make gen-types`; the generated TS preserves the shared shape
   via TS's intersection types.
4. Audit the FE for any code that constructs DataStatus/MainStatus
   from scratch (tests, mocks); update to use the base type.

**Size:** M.
**Risk:** Low — pure schema refactor; on-the-wire shape unchanged.

## 3. `/api/v1/screenshots/{filename}/ignore` uses POST where PUT fits

**Where:** `api/openapi.yaml:792` — endpoint declared as POST despite
being idempotent (re-ignoring an already-ignored file is a no-op +
returns the same 204).

**What breaks:** Inconsistency with the rule documented in
`.claude/rules/api-design.md`: "Don't use POST for setters — `PUT`
replaces a field value." Every other idempotent toggle (`/visibility`,
`/annotation`, the settings setters) uses PUT. The mismatch trips
contributors writing similar endpoints and is the kind of thing the
v1→v2 migration audit would have to clean up anyway.

**Plan:**

1. Add a new `PUT /api/v1/screenshots/{filename}/ignore` route
   wired to the same handler as the POST.
2. Mark the POST as deprecated in the spec (`deprecated: true`) and
   update the FE's `api.ts` wrapper to call PUT.
3. Remove the POST in the next breaking-change release.

**Size:** S.
**Risk:** Low — single FE caller; the POST handler stays around
through the deprecation cycle.

## 4. `POST /api/v1/matches/{matchKey}/resolution` returns 409 for a user-validation error

**Where:** `api/openapi.yaml:293-297` — "resolved_to must be one of
the candidates" returns 409.

**What breaks:** Per the API design rules, 409 is for resource-state
conflicts (the resource exists but is in a state incompatible with
the request — e.g., already resolved by another browser tab). A
bad target (`resolved_to` not in the candidate set) is a 400 — the
client sent invalid input. The current code routes the typed
sentinel `app.ErrInvalidResolution` to 409, conflating two distinct
failure modes.

**Plan:**

1. Switch the handler in `pkg/cmd/server_*.go` to map
   `ErrInvalidResolution` → 400, leaving any future "match is
   already resolved" error pointing at 409.
2. Update the OpenAPI response codes for the endpoint.
3. Note the change in CHANGELOG.md under "BREAKING (API)" since the
   FE may have special-cased 409.

**Size:** S.
**Risk:** Low — the FE today shows the error message verbatim
regardless of status code; the breaking part is downstream API
consumers.

## 5. `RecallExport` row schemas are `type: object` with no fields

**Where:** `api/openapi.yaml:2326-2330` — `summaries`, `scoreboards`,
`personals`, `ranks`, `unknowns` are declared as
`type: [array, "null"], items: { type: object }`.

**What breaks:** The import path
(`POST /api/v1/imports`) is permissive by design — it accepts any
shape the consumer can serialise — but the spec is no help to a
caller writing a third-party exporter or a schema-driven validator.
Any structural drift between the Go struct and what the FE/CLI
serialises goes uncaught.

**Plan:**

1. Define concrete `SummaryExportRow`, `ScoreboardExportRow`,
   `PersonalExportRow`, `RankExportRow`, `UnknownExportRow` schemas
   mirroring the column layout in `pkg/db/store.go::Summaries()`
   etc.
2. Reference them from the envelope's `items` field.
3. Keep `additionalProperties: true` on each row schema so the
   import path stays forward-compatible with rows that ship extra
   metadata.

**Size:** M.
**Risk:** Low — pure documentation tightening; existing exports
still validate as a superset of the new schemas.

## 6. Null-type syntax inconsistency across schemas

**Where:** scattered across `api/openapi.yaml` — some fields use
OpenAPI 3.1 `type: [string, "null"]` (e.g., lines 354-371), others
use bare `type: string` with implicit nullability via `required:
[…]` omission.

**What breaks:** Two equally-valid OpenAPI 3.1 styles get mixed in
one spec. Codegen tools (openapi-typescript among them) handle the
two differently — union-typed fields become `string | null`, omitted-
required fields become `string | undefined`. Downstream code has to
remember which is which.

**Plan:**

1. Pick one convention. Recommended: bare `type: T` + omit from
   `required` for "may be absent or null" — matches how the existing
   FE optionals already render.
2. Sweep the spec, converting `type: [T, "null"]` sites that
   currently sit alongside other optional fields.
3. Document the chosen convention in `.claude/rules/api-design.md`
   so the next contributor doesn't drift back.

**Size:** S.
**Risk:** Low.

## 7. Enum empty-string semantics undocumented

**Where:** `api/openapi.yaml:347` (`leaver`), `:482` (`queue_type`),
`:544` (`play_mode`) — each enum lists `""` as a valid value but the
metadata doesn't explain that the empty string means "clear the
bulk override" / "no value set."

**What breaks:** A reader scanning the spec sees `"", "self", "team",
"enemy"` and reasonably infers that the empty string is a valid
sentinel — but the semantics (it's the "clear" verb, not a fourth
value) are buried in the endpoint's body description elsewhere.

**Plan:**

1. Factor each enum into a named schema (`LeaverEnum`,
   `QueueEnum`, `PlayModeEnum`) with a top-level description
   explaining the empty-string semantics.
2. `$ref` the named schemas from every site that uses the literal
   enum today (request bodies, response shapes, query params).

**Size:** S.
**Risk:** Low.

## 8. `MatchAnnotation` members/tags response shape under-specified

**Where:** `api/openapi.yaml:2531-2545` — the
`GET /api/v1/matches/{matchKey}/annotation` response always returns
`members` + `tags` arrays but the schema doesn't list them as
required.

**What breaks:** Clients can't distinguish "never annotated" (404 on
the endpoint) from "annotated but no members/tags" (200 with empty
arrays). The PUT side accepts `null` / `[]` interchangeably for both
fields (lines 361-366), but a strict-mode consumer reading the
response can't tell whether the absence of `members` means "empty
array, save the bytes" or "field omitted entirely."

**Plan:**

1. Add `required: [leaver, note, replay_code, members, tags]` to the
   response schema.
2. Confirm the Go side always emits the field (use `make([]string, 0)`
   on nil slices, per `.claude/rules/api-design.md`).
3. Document at the operation level: "Absence of the row is signalled
   by 404, not by missing fields."

**Size:** S.
**Risk:** Low.

## 9. `ProfilesResponse` sort order undocumented

**Where:** `api/openapi.yaml:2705` — response description says
"Sorted list" without specifying the sort key.

**What breaks:** The FE's profile switcher today renders the list in
the order the server returns it. A future caller writing a CLI or a
sync tool can't tell whether to expect alphabetical-by-name,
creation-order, or last-used.

**Plan:**

1. Either tighten the description to "alphabetical by profile name"
   (the current Go behavior in `pkg/app/profile.go::List`), OR
2. Add an `order` field to the response so the contract is explicit
   and a future feature can return different orderings without
   breaking callers.

**Size:** S.
**Risk:** Low.

## 10. Diagnostic-only endpoints lack `x-internal` markers

**Where:** `api/openapi.yaml` — endpoints like
`/api/v1/system/screenshots-folder-candidates/stats` are diagnostic /
UI-polish surfaces, not stable contracts. Today they're documented
identically to load-bearing endpoints.

**What breaks:** Swagger UI users (the docs are auto-deployed to
`https://sound-barrier.github.io/recall/api/`) can't tell which
endpoints to depend on vs which are subject to change without
notice. Any third-party CLI / dashboard built against the spec might
mistake a polish endpoint for a stability commitment.

**Plan:**

1. Add `x-internal: true` to the diagnostic endpoints listed under
   "polish-only" in the `pkg/cmd/server_system.go` comments.
2. Add a Swagger UI filter (in `docs/api/index.html`) that hides
   `x-internal` operations by default; user can flip a toggle to
   show them.
3. Document the convention in `.claude/rules/api-design.md`.

**Size:** S.
**Risk:** Low.

## 11. `screenshots_dirs` `ON DELETE SET NULL` creates zombie screenshot rows

**Where:** `pkg/db/migrations/0001_init.sql:18,52,83,104,169` —
every parent screenshot table FK uses `screenshots_dir_id INTEGER
REFERENCES screenshots_dirs(id) ON DELETE SET NULL`.

**What breaks:** No current code path deletes a `screenshots_dirs`
row, but the schema permits it. If a deletion ever lands (manual
SQL surgery, a future "forget this folder" feature, a migration
typo), every dependent screenshot row keeps a `NULL` dir_id and the
`/_screenshot/<filename>` resolver can't find the file. The
screenshots appear "broken" in the detail panel with no diagnostic
explaining why. The risk is high because it's a silent corruption
mode that propagates from one schema-permissive choice to
user-visible breakage.

**Plan:**

1. Audit `pkg/db/store.go` + `pkg/db/screenshotsDirs.go` for any code
   that removes a row from `screenshots_dirs`. (Expected: none
   today.)
2. Flip the FK to `ON DELETE RESTRICT` in a new migration so SQLite
   refuses to delete a referenced directory.
3. Add a documented "clean up dependent rows first" path in
   `screenshotsDirs.Drop()` (if/when such a method lands) so the
   restrict isn't a deadlock.
4. Document the chosen invariant at the top of `0001_init.sql` so
   future contributors don't re-introduce SET NULL.

**Size:** M.
**Risk:** High — touches the on-disk schema; a botched migration
could strand users mid-startup. Stage behind a feature flag if the
audit turns up any concerning paths.

## 12. No composite `(match_key, parsed_at)` indexes on parent tables

**Where:** `pkg/db/migrations/0001_init.sql:35,64,87,112,172` — each
parent table has a single-column `idx_<table>_match_key` index, no
composite covering the `parsed_at` ordering used by `aggregateAll`.

**What breaks:** `pkg/db/store.go::aggregateAll` bulk-loads every
parent table and sorts the joined result by `match_key + parsed_at`
to fold per-screenshot rows into per-match records. The single-column
index covers the first half; the `parsed_at` sort runs on materialised
rows. For users with ~50k+ matches (the long-tail heavy-user case),
the sort becomes the dominant cost of every match-list load.

**Plan:**

1. Add `CREATE INDEX idx_<table>_match_key_parsed_at ON <table>
   (match_key, parsed_at)` for each of the 5 parent tables in a new
   migration. SQLite accepts index creation online.
2. Drop the older single-column indexes — the composite index covers
   the same queries (SQLite uses the leading column).
3. Benchmark `aggregateAll` on a corpus of 50k+ matches before/after.

**Size:** S.
**Risk:** Low — index addition is the canonical low-risk SQLite
migration.

## 13. `match_annotation_members` lacks reverse index on `(member)`

**Where:** `pkg/db/migrations/0003_match_annotation.sql` (or similar)
— PK is `(match_key, member)`; no index on `(member)` alone.

**What breaks:** Conditional — only if/when "find all matches
annotated with member X" becomes a feature (bulk operations by
player name, or a member-grouped dossier widget). Today the FE
filters in-memory after loading all annotations, which is fine for
small corpora; at scale the full-table scan would bite. The sibling
`match_annotation_tags` already has the parallel `(tag)` index, so
the schema is asymmetric.

**Plan:**

1. Defer until the feature lands. When it does:
2. Add `CREATE INDEX idx_match_annotation_members_member ON
   match_annotation_members (member)` in a new migration.

**Size:** S.
**Risk:** Low.

## 14. `distance_s` column name doesn't carry units

**Where:** `pkg/db/migrations/0001_init.sql:178` — column declared
as `distance_s INTEGER`; the comment / OpenAPI surface both call it
"distance in seconds."

**What breaks:** Ambiguous name (could read as "distance_singular"
or "distance_squared"). Sibling timestamp columns use full words
(`parsed_at`, `finished_at`). The OpenAPI schema already calls the
field `distance_seconds` (line 2487), so the DB column is the
outlier.

**Plan:**

1. Rename the column to `distance_seconds` in a migration.
2. Update `pkg/db/store.go` and any other SELECT/INSERT sites
   referencing the old name.
3. Regenerate any goldens that capture the column name.

**Size:** S.
**Risk:** Med — touches a column rename in a migration. SQLite's
`ALTER TABLE RENAME COLUMN` is safe but requires the migration
framework to run cleanly on existing user databases.

## 15. Inconsistent timestamp column names (`set_at` vs `*_at`)

**Where:** `pkg/db/migrations/` — most timestamps end in `_at`
(`parsed_at`, `annotated_at`, `hidden_at`, `ignored_at`,
`reviewed_at`) but the queue / play-mode override tables use
`set_at` (without a verb prefix).

**What breaks:** Minor cosmetic inconsistency; trips contributors
the first time they search "all timestamp columns by `_at` suffix"
and miss `set_at`. The grep-friendliness of the convention is the
practical loss.

**Plan:**

1. Rename `set_at` → `overridden_at` (or `bulk_set_at`) on the two
   override tables in a migration.
2. Update store.go SELECT/INSERT sites.

**Size:** S.
**Risk:** Low.

## 16. DB `match_key` vs OpenAPI `matchKey` naming drift

**Where:** DB columns use `match_key` (snake_case) consistently; the
OpenAPI path parameter is `matchKey` (camelCase). Go struct tags
split them — the field is `MatchKey` with a `json:"match_key"` tag,
while the path param decodes as `matchKey`.

**What breaks:** No bug, but new contributors trip on it — searching
for `match_key` finds DB / response JSON sites; searching for
`matchKey` finds path param sites. The mental model has to span
both names.

**Plan:**

1. Document the convention explicitly in `.claude/rules/database.md`
   and `.claude/rules/api-design.md`: DB columns are snake_case, API
   path params are camelCase, Go fields use camelCase with a
   snake_case JSON tag.
2. No code change.

**Size:** S.
**Risk:** Low — documentation only.

## 17. `screenshots_dir_id` column name confuses singular vs plural

**Where:** `pkg/db/migrations/0001_init.sql:18,52,83,104,169` —
column name `screenshots_dir_id` (singular "dir" in the middle of
plural "dirs").

**What breaks:** Minor cosmetic. The column name's middle word is
the FK target's table name minus the trailing `s` minus the `_id`
suffix — but the parsing isn't obvious. Reviewers occasionally
write `screenshot_dirs_id` or `screenshots_dirs_id` and get a
"column doesn't exist" error on first try.

**Plan:**

1. Add a SQL comment on the column in the migration: `-- references
   screenshots_dirs(id); NULL = orphaned (see TECHNICAL_DEBT.md item
   11)`.
2. No rename — touching the column name forces a migration on every
   user DB and the trade-off isn't worth it for a comment-fixable
   confusion.

**Size:** S.
**Risk:** Low.
