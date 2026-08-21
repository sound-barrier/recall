---
paths:
  - "api/**"
  - "pkg/cmd/**"
  - "frontend/src/api.ts"
---

# REST API & HTTP surface

Apply when adding or changing any `/api/v1/...` route so the surface stays
predictable. `api/openapi.yaml` is the canonical wire contract; this file
explains the rules behind it. The [Swagger UI](https://sound-barrier.github.io/recall/api/)
renders the spec for human readers.

## Versioning

Every JSON endpoint sits under `/api/v1/`. Breaking changes go to a new
`/api/v2/` — never quietly mutate an existing route's shape. Binary content
(image bytes, file downloads with non-JSON shapes) stays outside the JSON
surface; current example is `/_screenshot/{filename}`.

## Resources are nouns

Plural for collections (`/matches`, `/exports`, `/parses`); hierarchical for
ownership (`/matches/{match_key}/annotation`, `/settings/tesseract`). Don't put
verbs in paths — `POST /api/clear-database` became `DELETE /api/v1/matches`,
and `GET /api/probe-screenshots-dir` became
`GET /api/v1/system/screenshots-folder-probe`.

**Path parameters are snake_case** — `{match_key}`, `{filename}`,
`{profile}`. Mirrors the DB column convention so there's no boundary
to remember; the Go side reads with `r.PathValue("match_key")`. Don't
mix camelCase params into new endpoints.

## Method-to-intent mapping

| Verb | Semantics | Example |
|---|---|---|
| `GET` | Read; safe + idempotent. | `GET /api/v1/matches` |
| `PUT` | Upsert / replace a resource; idempotent. | `PUT /api/v1/settings/watcher` |
| `DELETE` | Wipe a collection, or reset a setting to its platform default (the user-set override is the thing being deleted). | `DELETE /api/v1/matches`, `DELETE /api/v1/settings/tesseract` |
| `POST` | Trigger an action that doesn't map to a single resource. | `POST /api/v1/parses` |

Don't use `POST` for setters — `PUT` replaces a field value. Model "reset to
default" as `DELETE` on the setting.

## Status codes

| Code | When |
|---|---|
| `200 OK` | GET with body, or write that echoes new state (e.g. `GET`/`PUT`/`DELETE /api/v1/settings/tesseract` all return re-detected status). Also: `PUT` that replaces server-side state without creating a new resource (`PUT /api/v1/profiles/active` switches the active profile). |
| `201 Created` | `POST` that creates a new resource — the response represents the just-created entity. Canonical: `POST /api/v1/profiles` (new profile + activated as a side effect). Don't unify `POST`-create's 201 with `PUT`-replace's 200; the asymmetry is HTTP-idiomatic. |
| `202 Accepted` | Action whose meaningful effect is out-of-band — `POST /api/v1/parses` writes SQLite + broadcasts SSE; HTTP body irrelevant. |
| `204 No Content` | Write succeeded with no useful body (most setters, `PUT /matches/{key}/visibility`, `PUT /matches/{key}/annotation`, `DELETE /api/v1/matches`). |
| `400 Bad Request` | Client validation failure. Reach via a typed sentinel (`app.ErrInvalidScreenshotsDir`, `app.ErrInvalidLeaver`, `app.ErrInvalidTesseractPath`, `app.ErrImportMalformed`) and `errors.Is` so it stays out of the catch-all 500. |
| `405 Method Not Allowed` | Wrong method on a registered route. Handled automatically by `apiMux` — see Mux structure. |
| `409 Conflict` | Request was syntactically valid but the resource state or payload semantics prevent the action (duplicate profile name, semantic-validation failure on `POST /api/v1/imports`, etc.). Distinct from `400`: a `400` is "your bytes don't parse"; a `409` is "your request parses fine but I can't do it." |
| `422 Unprocessable Entity` | Semantic-validation failure with a domain-specific shape that warrants its own code rather than the generic `409`. Current example: SHA-256 sidecar verification failure on `POST /api/v1/system/data-update` — see the shared `SHAVerificationFailed` response in `components.responses`. |
| `500 Internal Server Error` | Unexpected store/I/O failure. Anything reproducibly triggered by user input is 4xx, not 5xx. |

## Response shapes

- JSON for data; handlers emit `Content-Type: application/json` via `writeJSON`.
- **Arrays use `make([]T, 0)` server-side, never `var x []T`** — nil marshals to
  `null`, violates `type: array`, and trips schemathesis's
  `response_schema_conformance` in CI. Canonical: `aggregateAll` + the per-table
  loaders in `pkg/db/store.go`.
- Errors are `application/problem+json` (RFC 9457). `writeProblem(w, r, pt,
  detail, opts…)` (`pkg/cmd/server.go`) emits one problem for a `problemType` —
  the `prob*` registry maps slug → title → status under the
  `https://github.com/sound-barrier/recall/problems/` namespace; `instance` is
  `r.URL.Path`. Map app-layer errors with
  `writeError(w, r, err, errStatus{app.ErrX, probX}, …)`: first matching sentinel
  wins, unmatched falls through to a 500 problem;
  `if writeError(w, r, a.Foo()) { return }` guards the happy path. Use
  `writeJSON(w, r, v, err)` for the value-returning equivalent (err → 500
  problem, else encode). **§3.2 extension members:** `withFieldErrors(…)` adds a
  per-field `errors` array on body-validation 400s; `withFailedAssets(…)` adds
  the `failed_assets` list on the data-update 422 (the asset comes from
  `app.ChecksumError` via `errors.As`). Don't hand-roll the `errors.Is` ladder or
  re-emit plain text in a handler. **Carve-out:** `405 Method Not Allowed` stays
  plain (native ServeMux + the `methodNotAllowed` stubs), not problem+json. The
  shared `components.responses` ($ref'd everywhere) + a `ProblemDetails` schema in
  `api/openapi.yaml` document the contract.
- `204` / `202` carry no body; `_fetch` in `api.ts` resolves both to `undefined`.

## Request shapes

- JSON body for writes; `Content-Type: application/json`.
- Identity goes in the URL for hierarchical sub-resources
  (`/matches/{matchKey}/annotation` — body carries only annotation fields, not
  `match_key`).
- Query params for variants of the same operation (`/exports?format=json|csv`).

## Schema conventions

- **Nullability**: bare `type: T` + omit from `required` for "may be
  absent or null." Don't mix in OpenAPI 3.1's `type: [T, "null"]`
  shorthand — openapi-typescript renders the two differently (`T | null`
  vs `T | undefined`) and the inconsistency leaks into TS consumers.
  One spec, one convention.
- **Enums with sentinel values get named schemas.** Empty string
  meaning "clear the bulk override" (or any non-obvious value)
  belongs on a `$ref`'d schema with a top-level `description`
  explaining the semantics — `LeaverEnum`, `QueueTypeEnum`,
  `QueueTypeBulkEnum`, `PlayModeEnum`, `PlayModeBulkEnum` in
  `api/openapi.yaml`. Bulk variants that accept the empty-string
  sentinel get a `Bulk`-suffixed sibling so single-set endpoints
  can `$ref` the strict form.
- **`x-internal: true` flags diagnostic-only operations.** Endpoints
  meant for in-app diagnostics or polish — not stable contracts for
  third-party consumers — get `x-internal: true` at the operation
  level (e.g. `/system/screenshots-folder-candidates/stats`,
  `/system/tesseract-probe`). Swagger UI's filter in
  `docs/api/index.html` hides them by default.

## Mux structure (`pkg/cmd/server.go`)

API routes mount on `apiMux`, not the outer `mux`. Method-prefixed Go 1.22
patterns (`apiMux.HandleFunc("PUT /api/v1/foo", ...)`) give native 405 because
the sub-mux has no `/` catch-all. The outer `mux` mounts `apiMux` at `/api/v1/`,
`ScreenshotHandler` at `/_screenshot/`, and the SPA `FileServer` at `/`.

**Go ServeMux's no-method `/` SPA fallback eats method-mismatched requests.**
With method-prefixed patterns plus a `/` FileServer on the same mux, a
`GET /api/v1/parses` fully matches `/` (every method) and routes to the
FileServer (404) instead of returning 405. Keep `/api/v1/` on the dedicated
`apiMux` mounted via `mux.Handle("/api/v1/", apiMux)`. Pattern in
`pkg/cmd/server.go::NewMux`; new routes go on `apiMux`, not the outer `mux`.

## Adding or changing an endpoint (3 steps)

1. Add/modify the method on `*app.App` in `pkg/app/*.go`. Use a typed sentinel
   for any user-input-driven error you want surfaced as 4xx.
2. Edit `api/openapi.yaml` (pick verb + status code per the tables — every
   operation MUST carry a unique `operationId`; hey-api names the SDK function
   from it and Spectral errors without one) and register the route in
   `newAPIMux` in `pkg/cmd/server.go` (both binaries + the Wails asset-server
   middleware share it; only `/api/v1/events` is server-only — see the SSE
   note below). `task gen-types` regenerates `frontend/src/client/`; the
   lefthook pre-commit hook reruns it so a stale client can't slip into a
   commit.
3. Add the `api.ts` facade wrapper over the generated SDK function
   (`unwrap(sdk.<operationId>({ path, body, query }))`, `unwrapVoid` for
   204/202 writers) and call it via `@/api-client`. ONE fetch transport
   serves desktop and server mode — there is no dual-path step anymore, and
   a missing wrapper is a compile error at its call site.

**Adding a field to an existing Go struct** is 2 steps: (1) update struct +
OpenAPI schema, (2) `task gen-types` to refresh `frontend/src/client/`.
`frontend/bindings/` is gitignored + regenerated by builds; nothing imports
it — the wire contract lives in the generated client.

**SSE / streaming endpoints are server-only.** The Wails asset server on
Windows buffers whole responses (no Flush, no request-context cancellation),
so a streaming handler hangs the webview. `newAPIMux` deliberately excludes
`/api/v1/events`; desktop events ride the Wails event bus
(`api-platform.ts`'s EventsOn). Register any future streaming route the same
way — in `NewMux` only — and document the payload schema in
`components.schemas` + the events operation's `x-event-payloads`.

## Generation + validation

| Command | Purpose |
|---|---|
| `make gen-types` | Regenerate `api.gen.d.ts` from the spec. Runs on every commit via lefthook; CI fails if out of sync. |
| `make lint-openapi` | Spectral lint (`spectral:oas` + `.spectral.yaml`, `--fail-severity=warn`). In `make lint` + a pre-commit hook. |
| `make swagger` | Browse the spec locally — Swagger UI v5 in a container (`:8080` default; `SWAGGER_PORT` to override). |
| `make check-api-drift` | Fuzzes a built `recall-server` against `api/openapi.yaml` via schemathesis to catch shape drift. Logic in `scripts/check-api-drift.sh` (same as CI's `schemathesis` job + the pre-push hook, glob-scoped to API + server code). Requires `pipx install 'schemathesis>=3.36,<4'`. Skip the hook with `LEFTHOOK_EXCLUDE=schemathesis git push`. |

Public Swagger UI auto-deploys from `main` on every spec change to
<https://sound-barrier.github.io/recall/api/>.

## Transport gotchas

- **204 / 202 responses resolve to `undefined` via `unwrapVoid`.** The
  generated client parses empty bodies as `{}`; the facade's `unwrapVoid`
  discards that so void-returning callers keep the historical contract
  (pinned by `api.test.ts`'s "r.json()-on-204 regression" case).

- **Frontend imports api functions from `@/api-client`** (the test seam over
  `frontend/src/api.ts`). `api.ts` is a named-function facade over the
  generated SDK (`src/client/`) — one fetch transport for desktop (the Wails
  asset-server middleware) and server mode alike. Only the native-dialog /
  events / binary surface still branches on the runtime, in
  `api-platform.ts`. URLs must stay root-relative `/api/v1/...` — the
  codegen config pins `baseUrl: false` and `api.test.ts` pins the
  origin-relative resolution; a baked absolute URL breaks both the Wails
  origin and every e2e `page.route` mock.

- **The `_screenshot/<filename>` URL prefix** is reserved for the on-disk
  screenshots handler. Don't reuse it for other dynamic assets.

- **Wails AssetServer custom routes need Middleware, not Handler, in dev mode.**
  `Options.Handler` only fires on 404/405, but Vite's SPA fallback returns
  `index.html` with 200 for unknown routes — path-prefixed handlers
  (`/_screenshot/`) never run. `pkg/cmd/wails.go` registers `ScreenshotHandler`
  as Middleware that short-circuits before the proxy. Production works either
  way; only `wails dev` needs Middleware.

- **Match keys are URL-safe** — `match_key` is `match-<ISO-timestamp>` (with `-`
  separating date AND time components, e.g. `match-2026-05-10T22-21-11`),
  `unmatched-<base64url(filename)>`, or `ambiguous-<base64url(filename)>`. No
  colons inside the key, and the two sentinel bodies base64url-encode the filename
  (alphanumerics + `-` `_`), so the whole key is URL-safe — pasting it raw into a
  path "just works" with no escaping. `match.Filename()` (Go) decodes the body;
  the frontend treats it as opaque. The dash form
  is what the parser emits today; there is no legacy-colon migration on startup
  (a `migrateMatchKeysColonToDash` was documented here but never existed — only a
  test fixture string references it). The frontend's `matchTime()` helper
  rewrites the `-` time separators back to `:` for display; `data.finished_at`
  is unaffected (still `HH:MM:SS`).

- **Bad client/config input is 4xx, not 5xx.** App layer returns a typed sentinel
  (`fmt.Errorf("%w: ...", sentinel, ...)`); HTTP handlers `errors.Is` it to 400,
  everything else falls through to 500. Reserve 5xx for unexpected internal
  failures. Canonical handlers: `PUT /api/v1/settings/screenshots-folder`,
  `POST /api/v1/parses`.

## Handler test pattern

`httptest.NewRequest` + `NewRecorder` is the HTTP-handler test pattern. Used by
`pkg/cmd/server_test.go` (mux via `get`/`put`/`del`/`fire` helpers — `fire` is
the generic-method primitive the others wrap), `pkg/metrics/metrics_test.go`,
`pkg/app/screenshot_handler_test.go`. For App handlers, mutate `a.settings.X`
directly (not via `SetX`, which writes to real `settings.json`). **Gotcha**:
`httptest.NewRequest` panics on malformed escapes (`%ZZ`). To test
`url.PathUnescape` branches, build a valid request then mutate `req.URL.Path`
directly — that skips re-validation. See
`TestScreenshotHandler_RejectsMalformedURLEscape`.
