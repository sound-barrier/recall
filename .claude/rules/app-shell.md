---
paths:
  - "pkg/app/**"
---

# App shell (`pkg/app/`)

`App` owns:

- `settings` (`<App.dataDir()>/settings.json` =
  `<appBaseDir>/profiles/<active>/settings.json`): screenshots dir, tesseract
  path, watch enabled. Each toggle persists on change. Per-profile.
  `appBaseDir()` install roots: `~/Library/Application Support/Recall/` (macOS),
  `~/.config/recall/` (Linux), `%AppData%\Recall\` (Windows).
- `profiles` (`*Profiles`, `pkg/app/profile.go`): owns the install's profile
  manager. `<base>/profiles.json` tracks active profile + the list. Each profile
  gets `<base>/profiles/<name>/{settings.json,db/recall.db}`. Methods:
  `Create`/`Activate`/`Rename`/`Delete`. App methods:
  `GetProfiles`/`CreateProfile`/`SwitchProfile`/`RenameProfile`/`DeleteProfile`
  (each tears down + re-inits store/watcher for the active swap).
  Cross-profile match move: `App.MoveMatches(keys, target)` in
  `pkg/app/profile_move.go` — two-phase (write target, delete source) so a
  mid-transfer crash leaves the canonical copy on the target. **No migration**
  from any prior single-profile layout — fresh installs only.
- File watcher (`watcher`, `watchedDir`, `watchTimer`, `watchMu`) with
  `watchDebounce = 60*time.Second`: any new `.png`/`.jpg` resets a timer; expiry
  runs `ParseScreenshots` (which now emits `parse-complete` itself).
- **Duplicate sweep** (`pkg/app/duplicate_sweep.go`): runs at the END of
  `runClaimedParse`, after the OCR loop, and demotes run-created tracked
  matches that duplicate an existing one into the ambiguous queue via
  `Store.DemoteMatchToAmbiguous` (inverse of `ResolveAmbiguous`). TWO
  producers behind one entry point: the TEAMS stat line (30 min - 7 days)
  and the match's own played-at identity (unwindowed, and the only one that
  works with no TEAMS shot). Only keys absent from
  `parseRunState.preRunKeys` are judged - pre-existing history is never
  demoted and `ReParseAll` is exempt by construction (every re-adopted key
  pre-exists). Candidate "reason" is STAMPED by its producer and stored on
  the row: the two overlap on the distance axis, so it cannot be derived.
  **Build `correlate.NewDuplicateScan(snap)` ONCE and call `CandidatesFor`
  per key** - the one-shot `FindDuplicateCandidates` re-reads the whole
  snapshot, which made a first import quadratic (18 s at 5 000 matches).
  Resolving to a fresh key records the verdict in `duplicate_matches`, and
  both cards carry a "possible duplicate of" chip naming the other.
- **Parse run-state (single-flight, async-job)**: `parseRunning` + the
  progress snapshot (`parseDone`/`parseTotal`/`parseScope`) + `parseCancel` all
  live under `parseCancelMu`. `claimParse`/`endParse` bracket a run; a second
  trigger fails fast with `ErrParseInFlight` (no queuing). `StartParse(force)`
  runs the parse in a **background goroutine** (server `POST /parses`, returns
  202 up-front); `ParseScreenshots`/`ReParseAll` are the synchronous Wails-IPC +
  watcher + test path. `runClaimedParse` emits `parse-complete` on success for
  EVERY path, so the frontend drives `parseBusy` off SSE, not a held-open
  request. `ActiveParse()` (`GET /api/v1/parses/active`) is the resync snapshot
  for a reconnecting/reloading client.
- `SSEHub *SSEHub` — non-nil in server mode; broadcasts `parse-complete` to
  connected browser tabs.

**File layout**: `ls pkg/app/*.go` — file-per-concern (`tesseract.go`,
`watcher.go`, `aggregate.go`, `coach_session.go`, …); production + test files are
1:1 (`watcher.go` ↔ `watch_events_test.go`). Build-tag pairs: `app_wails.go` /
`app_server.go` (dialog + event-emit shims).

**Wails-bound methods**: every exported `*app.App` method is auto-bound —
`grep -rE '^func \(a \*App\) [A-Z]' pkg/app/*.go` lists the surface. Same methods
exposed under `/api/v1/...` via `pkg/cmd/server.go`. `api/openapi.yaml` is the
contract for both transports; `task gen-types` regenerates `api.gen.d.ts`. (Full
endpoint rules: `.claude/rules/api-design.md`.)

**Constructor**: `app.New()` in `pkg/app`.

**HTTP server mode** fires when `-s`/`--server` is passed to the Wails binary, or
always when compiled `serveronly`. `PickScreenshotsDir` / `PickTesseractBinary`
(native dialogs) are replaced by `PUT /api/v1/settings/screenshots-folder` +
`PUT /api/v1/settings/tesseract`; `api.ts` falls back to `window.prompt()`.

**Wails-bound handler**: `ScreenshotHandler()` serves `/_screenshot/<filename>`
from the configured screenshots dir — used by both Wails `AssetServer.Handler`
and the server-mode mux.

## Read-time inference

`pkg/aggregate/inference.go` helpers (`InferSoleHeroPercent`, `InferResultFromRank`)
run on the way *out* via `GetMatchResults` — never inside
`mergeMatchResult` or any write path. Storing an inferred value would shadow a
later screenshot's real value in the first-non-empty-wins fold (e.g. inferred
`result="victory"` from SR change would block a SUMMARY's authoritative
`result`).

## Storage-side classification

**`screenshotType(r)` must check E/A/D before hero stats.** Teams parses
populate both `r.Eliminations/Assists/Deaths` and `r.HeroesPlayed[*].Stats` (the
right-side panel cards). A hero-stats-first check would mis-classify every
teams with a populated panel as `personal`. Order: rank → summary →
teams (E/A/D) → personal (hero stats) → unknown.

## Path-input boundary validators (security-sensitive)

User-controlled paths from HTTP go through a boundary validator before
`exec.Command` / `os.Stat`. Canonical: `validateScreenshotsDir`
(`screenshots_dir.go`) + `validateTesseractPath` (`tesseract.go`) — shared
`safePathChars` regex + `filepath.Clean` equality + return the cleaned value so
the sanitized form reaches syscalls. CodeQL recognizes this as a sanitizer for
`go/command-injection` + `go/path-injection`. New path-accepting endpoints must
reuse `safePathChars`.

**Windows Tesseract installer paths contain spaces and parens** —
`defaultTesseractPath()` returns `C:\Program Files\Tesseract-OCR\…` or
`C:\Program Files (x86)\Tesseract-OCR\…` on Windows. Any regex constraining path
strings must allow `()` or it'll reject the Windows default out of the box (a
past test cycle was spent tracking this down — don't repeat).

## Test seams

**Outbound HTTP uses a `var url = "..."` seam, not an injected `*http.Client`.**
`pkg/app/update.go` exposes `releasesURL` as a package var so
`check_for_update_test.go` can swap to an `httptest.NewServer` URL. Same pattern
works for any package-level test mutation (`withVersion(t, "0.1.0-dev")` swaps the
ldflags-injected `Version`). Recipe: `prev := X; X = newVal; t.Cleanup(func() { X = prev })`.
