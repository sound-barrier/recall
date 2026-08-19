/**
 * api.ts — the app-facing API facade over the generated hey-api SDK
 * (src/client, regenerated from api/openapi.yaml by `task gen-types`).
 *
 * ONE fetch transport serves both modes: the desktop webview reaches the
 * same REST mux through the Wails asset-server middleware (pkg/cmd's
 * apiMiddleware), server mode reaches it over the network. The old
 * Call.ByName RPC branch is gone — only the native-dialog / events /
 * binary surface still branches on the runtime, in api-platform.ts.
 *
 * Server HTTP conventions:
 *   - All JSON endpoints under /api/v1/; URLs stay root-relative so they
 *     resolve against the serving origin (never a baked servers[] URL).
 *   - GET to read, PUT to replace/upsert a resource, DELETE to clear or
 *     reset, POST to start an action that doesn't map to a single
 *     resource (the parse run).
 *   - 204 / 202 responses resolve to undefined via unwrapVoid.
 */

import { IS_WAILS, wailsCall } from '@/api-platform'
import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type {
  CoachDecisionEnum,
  CoachingSettings,
  CoachMoment,
  CoachMomentInput,
  MatchMomentInput,
  CoachNote,
  CoachNoteInput,
  CoachReturnSheet,
  CoachSessionView,
  SelfReview,
  SelfReviewNote,
  DbHealth,
  GetReferenceDataResponses,
  GetScreenshotsFolderCandidateStatsResponses,
  TesseractStatus,
  ManualMatchInput,
  MatchRecord,
  ProfilesResponse,
  SeedTestProfileResponse,
  UpdateInfo,
  DataUpdateResult,
  ActiveParse,
  AutoBackupStatus,
  DataLocation,
  FailedFile,
  IgnoredScreenshot,
  GetParseStalenessResponses,
  NamedCandidate,
  ProbeResult,
  UserMatchDataInput,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.
export type {
  ActiveParse,
  AutoBackupStatus,
  CoachDecisionEnum,
  CoachFocusTagEnum,
  CoachMatchContext,
  CoachMoment,
  CoachNote,
  CoachNoteInput,
  CoachNoteKindEnum,
  CoachPlayer,
  CoachReturnItem,
  CoachReturnSheet,
  CoachSessionChangedEvent,
  CoachSessionView,
  MatchCoachNote,
  MatchSelfReviewNote,
  SelfReview,
  SelfReviewNote,
  DataLocation,
  DataUpdateResult,
  FailedFile,
  HeroPlay,
  IgnoredScreenshot,
  ManualMatchInput,
  MatchRecord,
  MatchResult,
  NamedCandidate,
  ProbeResult,
  ProblemDetails,
  ProfilesResponse,
  ScreenshotType,
  SeedTestProfileResponse,
  TesseractStatus,
  UpdateInfo,
  UserMatchDataInput,
} from '@/client/types.gen'

// The generated name is DbHealth; the app-facing alias predates it.
export type DBHealth = DbHealth

// Static Overwatch reference data baked into the parser at compile time
// from pkg/parser/{heroes,maps,seasons,screenshot_sources}.yaml. Stable
// across a session — callers may fetch once at app load and cache. The
// shape is the spec's inline response schema.
export type OWData = GetReferenceDataResponses[200]
export type ParseStaleness = GetParseStalenessResponses[200]

// NamedCandidateStats is the per-source diagnostic blob the picker grid
// hydrates AFTER the cards mount (file_count + last_modified +
// recognized_count). The shape is the spec's inline response schema.
export type NamedCandidateStats = GetScreenshotsFolderCandidateStatsResponses[200][number]

// The platform-bound surface (native dialogs, events, OpenURL, binary
// import/export) is re-exported so '@/api' keeps its full historical
// export surface — api-client.ts binds every name from here.
export {
  BackupDatabase,
  EventsOff,
  EventsOn,
  ExportBundle,
  ExportCoachNotes,
  ExportDiagnosticBundle,
  ExportMatchesCSV,
  ImportMatches,
  OpenCoachBundle,
  OpenURL,
  RestoreDatabase,
  setEventStreamStatusHandler,
} from '@/api-platform'
export type { EventStreamStatus, MatchImportKind, MatchImportResult } from '@/api-platform'
export { ApiError } from '@/api-error'

// ─── System / version / update ─────────────────────────────────────────────

export function GetVersion(): Promise<string> {
  return unwrap(sdk.getVersion()).then(d => d.version)
}

// Captured Startup failure or empty when boot was clean. useAppBoot reads
// this once and renders a blocking modal when non-empty.
export function GetStartupError(): Promise<string> {
  return unwrap(sdk.getStartupError()).then(d => d.message)
}

export function CheckForUpdate(): Promise<UpdateInfo> {
  return unwrap(sdk.checkForUpdate())
}

// ApplyGameDataUpdate pulls the live YAMLs from the docs site's data
// channel, SHA-256-verifies them, and swaps the running parser dataset.
// Throws ApiError: 502 when Pages is unreachable, 422 on SHA mismatch,
// 500 on local disk failure.
export function ApplyGameDataUpdate(): Promise<DataUpdateResult> {
  return unwrap(sdk.applyGameDataUpdate())
}

// In-app binary self-update (desktop, when UpdateInfo.can_self_update is
// true). Both are 202/void; the work + restart happen out-of-band and
// progress arrives as wails:updater:* events. A 409 (self-update
// unavailable) rejects with ApiError.
export function StartSelfUpdate(): Promise<void> {
  return unwrapVoid(sdk.startSelfUpdate())
}
export function RestartToApply(): Promise<void> {
  return unwrapVoid(sdk.restartToApply())
}

export function GetOWData(): Promise<OWData> {
  return unwrap(sdk.getReferenceData())
}

export function GetDataLocation(): Promise<DataLocation> {
  return unwrap(sdk.getDataLocation())
}

// How many matches an older parser read. A parser fix only reaches files
// parsed AFTER it ships, so without this the improvement lands on new
// captures while the existing history quietly keeps its old readings.
export function GetParseStaleness(): Promise<ParseStaleness> {
  return unwrap(sdk.getParseStaleness())
}

// ─── Matches (read) ────────────────────────────────────────────────────────

export function GetMatchResults(): Promise<MatchRecord[]> {
  return unwrap(sdk.getMatchResults())
}

export function GetNewScreenshotCount(): Promise<number> {
  return unwrap(sdk.getPendingScreenshotCount()).then(d => d.count)
}

// List the suppress-list with timestamps. Sorted most-recently-ignored
// first; tie-break is filename ASC.
export function GetIgnoredScreenshots(): Promise<IgnoredScreenshot[]> {
  return unwrap(sdk.getIgnoredScreenshots())
}

// List the OCR-failure ledger, most recently failed first — the Unknown
// tab's "Failed to read" triage section.
export function GetFailedFiles(): Promise<FailedFile[]> {
  return unwrap(sdk.getFailedFiles())
}

// ─── Matches (write) ───────────────────────────────────────────────────────

// Per-match user annotation. All fields are optional but at least one must
// carry content — PUT is upsert-only and rejects an all-empty body (400).
// Clearing a row is DeleteMatchAnnotation (DELETE).
//
// `leavers` and `throwers` are SETS of DisruptionSide: a match can be
// disrupted on both teams at once, and the leaver-exit quick-add records
// "a teammate left, then I left" as ['team', 'self'].
export type DisruptionSide = 'self' | 'team' | 'enemy'

export interface MatchAnnotationInput {
  leavers?:     DisruptionSide[]
  throwers?:    DisruptionSide[]
  note?:        string
  replay_code?: string
  members?:     string[]
  // Free-form match labels — `stack`, `stream`, `placement` are the three
  // conventional ones surfaced as quick-add toggles in the inline editor.
  // Server lowercases + dedupes; any string is accepted.
  tags?:        string[]
}

// Always sends the full six-field row so partial inputs from the frontend
// (note-only edit, members-only edit) don't accidentally null fields the
// user typed in another input.
export function SetMatchAnnotation(matchKey: string, input: MatchAnnotationInput): Promise<void> {
  return unwrapVoid(sdk.setMatchAnnotation({
    path: { match_key: matchKey },
    body: {
      leavers:     input.leavers ?? [],
      throwers:    input.throwers ?? [],
      note:        input.note ?? '',
      replay_code: input.replay_code ?? '',
      members:     input.members ?? [],
      tags:        input.tags ?? [],
    },
  }))
}

// Clear a match's annotation row entirely (members + tags cascade).
// Idempotent — deleting an absent annotation resolves quietly.
export function DeleteMatchAnnotation(matchKey: string): Promise<void> {
  return unwrapVoid(sdk.deleteMatchAnnotation({ path: { match_key: matchKey } }))
}

// Hard-delete a single match. Every parent row + annotation + the hidden
// flag is wiped; the screenshot files on disk are untouched, so a re-parse
// will rediscover them. Idempotent.
export function HardDeleteMatch(matchKey: string): Promise<void> {
  return unwrapVoid(sdk.hardDeleteMatch({ path: { match_key: matchKey } }))
}

// Hand-enter a match (no OCR). The server derives the match_key from
// played_at (default now), 409s on a collision, and returns the created
// MatchRecord (source: "manual").
export function CreateManualMatch(input: ManualMatchInput): Promise<MatchRecord> {
  return unwrap(sdk.createManualMatch({ body: input }))
}

// Replace a match's user-data override set — the editable copy kept
// separate from the parsed OCR rows. The body is the FULL override set; a
// per-field revert is the same call omitting that field. Idempotent.
export function UpdateMatchData(matchKey: string, input: UserMatchDataInput): Promise<void> {
  return unwrapVoid(sdk.updateMatchData({ path: { match_key: matchKey }, body: input }))
}

// Reset a match to pure OCR by clearing its override set. Idempotent.
// (Deleting a manual match is HardDeleteMatch instead.)
export function ResetMatchData(matchKey: string): Promise<void> {
  return unwrapVoid(sdk.resetMatchData({ path: { match_key: matchKey } }))
}

// Per-match review-status tag. `reviewedBy` is `'self'`, `'coach'`, or
// `''` (the implicit "not reviewed" third state). An empty value issues a
// DELETE on the row; the others issue a PUT. Both directions idempotent.
export type ReviewedBy = '' | 'self' | 'coach'

export function SetMatchReview(matchKey: string, reviewedBy: ReviewedBy): Promise<void> {
  const path = { match_key: matchKey }
  if (reviewedBy === '') return unwrapVoid(sdk.clearMatchReview({ path }))
  return unwrapVoid(sdk.setMatchReview({ path, body: { reviewed_by: reviewedBy } }))
}

// Per-match queue-type tag (Role Queue 5v5 vs Open Queue 6v6). Empty
// string clears via DELETE. Mirrors SetMatchReview's shape.
export type QueueType = '' | 'role' | 'open'

export function SetMatchQueue(matchKey: string, queueType: QueueType): Promise<void> {
  const path = { match_key: matchKey }
  if (queueType === '') return unwrapVoid(sdk.clearMatchQueue({ path }))
  return unwrapVoid(sdk.setMatchQueue({ path, body: { queue_type: queueType } }))
}

// Per-match play-mode override (Quickplay vs Competitive). Empty string
// clears via DELETE, reverting to the aggregator's fallback chain.
export type PlayMode = '' | 'quickplay' | 'competitive'

export function SetMatchPlayMode(matchKey: string, playMode: PlayMode): Promise<void> {
  const path = { match_key: matchKey }
  if (playMode === '') return unwrapVoid(sdk.clearMatchPlayMode({ path }))
  return unwrapVoid(sdk.setMatchPlayMode({ path, body: { play_mode: playMode } }))
}

// Bulk write — apply the same queue_type to every match_key in one
// transaction. '' clears (bulk Clear). Powers the sticky bulk-action
// toolbar without paying per-match round-trips.
export function BulkSetMatchQueue(matchKeys: string[], queueType: QueueType): Promise<void> {
  return unwrapVoid(sdk.bulkSetMatchQueue({ body: { match_keys: matchKeys, queue_type: queueType } }))
}

export function BulkSetMatchPlayMode(matchKeys: string[], playMode: PlayMode): Promise<void> {
  return unwrapVoid(sdk.bulkSetMatchPlayMode({ body: { match_keys: matchKeys, play_mode: playMode } }))
}

// Star/unstar — the /pin sub-resource, SetMatchVisibility's twin.
export function SetMatchPin(matchKey: string, pinned: boolean): Promise<void> {
  return unwrapVoid(sdk.setMatchPin({ path: { match_key: matchKey }, body: { pinned } }))
}

// Soft-delete a match. Reversible: pass hidden=false to restore. Both
// directions are idempotent.
export function SetMatchVisibility(matchKey: string, hidden: boolean): Promise<void> {
  return unwrapVoid(sdk.setMatchVisibility({ path: { match_key: matchKey }, body: { hidden } }))
}

// Resolve an ambiguous-attribution screenshot by attaching every parent
// row carrying the sentinel to the user's chosen match. `resolvedTo` must
// be one of the candidates surfaced on `MatchRecord.candidates` OR a
// freshly-minted "match:<ts>" key (the "Treat as new match" escape hatch).
export function ResolveAmbiguousMatch(ambiguousMatchKey: string, resolvedTo: string): Promise<void> {
  return unwrapVoid(sdk.resolveAmbiguousMatch({
    path: { match_key: ambiguousMatchKey },
    body: { resolved_to: resolvedTo },
  }))
}

// Bulk-move matches from the active profile to another profile. The server
// transfers every row + annotation + hidden flag in two phases (write
// target, then delete source) so a mid-transfer failure leaves the
// canonical copy on the target.
export function MoveMatches(matchKeys: string[], targetProfile: string): Promise<void> {
  return unwrapVoid(sdk.moveMatches({ body: { match_keys: matchKeys, target_profile: targetProfile } }))
}

// Wipe all parsed-match data — DELETE on the matches collection. Settings
// and the screenshots folder are untouched. Pass `keepIgnored = true` to
// preserve the Unknown-tab "Delete forever" suppress list across the wipe.
export function ClearDatabase(keepIgnored = false): Promise<void> {
  return unwrapVoid(sdk.clearMatches(
    keepIgnored ? { query: { keep_ignored: true } } : {},
  ))
}

// ─── Screenshots suppress-list ─────────────────────────────────────────────

// Permanently ignore a screenshot — backs the Unknown tab's "Delete
// forever" affordance. Adds the filename to the suppress-list AND wipes
// the matching unmatched-/ambiguous- rows. The on-disk file is NOT
// deleted. Idempotent.
export function IgnoreScreenshot(filename: string): Promise<void> {
  return unwrapVoid(sdk.ignoreScreenshot({ path: { filename } }))
}

// Restore an ignored screenshot so the next Parse run picks it back up.
// Idempotent on filenames that aren't ignored.
export function UnignoreScreenshot(filename: string): Promise<void> {
  return unwrapVoid(sdk.unignoreScreenshot({ path: { filename } }))
}

// Bulk truncate the suppress-list — Settings panel's "Re-enable all".
export function ClearIgnoredScreenshots(): Promise<void> {
  return unwrapVoid(sdk.clearIgnoredScreenshots())
}

// ─── Parse pipeline ────────────────────────────────────────────────────────

export function ParseScreenshots(): Promise<void> {
  return unwrapVoid(sdk.parseScreenshots())
}

// ReParseAll re-runs OCR on every PNG in the watched folder, including
// files already in the DB. The Upsert is idempotent on filename so the
// user's annotations / queue / play-mode / hidden / review state survive.
export function ReParseAll(): Promise<void> {
  return unwrapVoid(sdk.parseScreenshots({ query: { scope: 'all' } }))
}

// Cancel an in-flight parse. The OCR loop checks ctx.Err() between
// screenshots. Callers await the `parse-canceled` event to flip the Stop
// button back; a 409 (parse already finished) rejects with ApiError and
// is deliberately swallowed at the call site.
export function CancelParse(): Promise<void> {
  return unwrapVoid(sdk.cancelParse())
}

// Active-parse status snapshot — the resync anchor for the async parse
// pipeline. A client that reconnects or reloads mid-parse reads this to
// restore "is a parse running, and how far along".
export function GetActiveParse(): Promise<ActiveParse> {
  return unwrap(sdk.getActiveParse())
}

// ─── Settings ──────────────────────────────────────────────────────────────

export function GetScreenshotsDir(): Promise<string> {
  return unwrap(sdk.getScreenshotsFolder()).then(d => d.path)
}

// Desktop: native folder picker (falls back to the existing value on
// cancel). Server mode: prompt for a path and PUT it.
export async function PickScreenshotsDir(): Promise<string> {
  if (IS_WAILS) return wailsCall('PickScreenshotsDir')
  const current = await GetScreenshotsDir()
  const p = window.prompt('Screenshots directory path:', current)
  if (!p) return current
  await SetScreenshotsDir(p)
  return p
}

// GetScreenshotsFolderCandidates returns the per-source picker list
// (empty on non-Windows — auto-detect is Windows-only by design).
export function GetScreenshotsFolderCandidates(): Promise<NamedCandidate[]> {
  return unwrap(sdk.getScreenshotsFolderCandidates())
}

// The deferred per-source diagnostics call. The picker grid fetches this
// after the cards mount so the directory walk (bounded to 1000 entries
// per source) doesn't block the visible UI.
export function GetScreenshotsFolderCandidateStats(): Promise<NamedCandidateStats[]> {
  return unwrap(sdk.getScreenshotsFolderCandidateStats())
}

// SetScreenshotsDir persists `path` as the active screenshots directory.
// Used by the "Detect Overwatch Folder" button to apply a probe result
// without going through the native folder picker.
export function SetScreenshotsDir(path: string): Promise<void> {
  return unwrapVoid(sdk.setScreenshotsFolder({ body: { path } }))
}

// ResetScreenshotsDir clears the persisted screenshots folder and tears
// down the watcher. Symmetric with ResetTesseractPath.
export function ResetScreenshotsDir(): Promise<void> {
  return unwrapVoid(sdk.resetScreenshotsFolder())
}

// RevealScreenshotsDir opens the configured folder in the host OS file
// manager. No path argument: the configured folder is the only thing this
// action reveals, so passing an arbitrary path would widen attack surface.
export function RevealScreenshotsDir(): Promise<void> {
  return unwrapVoid(sdk.revealScreenshotsFolder())
}

export function GetWatchEnabled(): Promise<boolean> {
  return unwrap(sdk.getWatchEnabled()).then(d => d.enabled)
}

export function SetWatchEnabled(enabled: boolean): Promise<void> {
  return unwrapVoid(sdk.setWatchEnabled({ body: { enabled } }))
}

export function GetExitOnClose(): Promise<boolean> {
  return unwrap(sdk.getExitOnClose()).then(d => d.exit_on_close)
}

export function SetExitOnClose(exitOnClose: boolean): Promise<void> {
  return unwrapVoid(sdk.setExitOnClose({ body: { exit_on_close: exitOnClose } }))
}

export function GetTesseractStatus(): Promise<TesseractStatus> {
  return unwrap(sdk.getTesseractSettings())
}

// Desktop: native file picker. Server mode: prompt for the binary path
// then PUT it, echoing the re-detected status.
export async function PickTesseractBinary(): Promise<TesseractStatus> {
  if (IS_WAILS) return wailsCall('PickTesseractBinary')
  const current = await GetTesseractStatus().then(d => d.path || '')
  const p = window.prompt('Path to Tesseract binary:', current)
  if (!p) return GetTesseractStatus()
  return SetTesseractPath(p)
}

// Reset to the platform default — modeled server-side as DELETE on the
// tesseract setting (the user-set override is the thing being deleted).
// Returns the re-detected status.
export function ResetTesseractPath(): Promise<TesseractStatus> {
  return unwrap(sdk.resetTesseractPath())
}

// ProbeTesseractBinary walks per-OS install locations + PATH and returns
// the first that resolves to a working Tesseract 5.x. Read-only — the
// caller (Detect button) decides whether to apply via SetTesseractPath.
export function ProbeTesseractBinary(): Promise<ProbeResult> {
  return unwrap(sdk.probeTesseractBinary())
}

// SetTesseractPath applies a known path (from the picker or the Detect
// probe) and returns the re-detected status.
export function SetTesseractPath(path: string): Promise<TesseractStatus> {
  return unwrap(sdk.setTesseractPath({ body: { path } }))
}

export function GetAutoBackupStatus(): Promise<AutoBackupStatus> {
  return unwrap(sdk.getAutoBackupStatus())
}

export function SetAutoBackupInterval(intervalDays: number): Promise<AutoBackupStatus> {
  return unwrap(sdk.setAutoBackupInterval({ body: { interval_days: intervalDays } }))
}

// ─── Profiles ──────────────────────────────────────────────────────────────
//
// Each profile is its own settings + SQLite DB under
// <base>/profiles/<name>/. Switching tears down the server's in-memory
// state and re-initializes — the SPA reloads after each Create/Switch so
// every consumer re-fetches against the new active profile.

export function GetProfiles(): Promise<ProfilesResponse> {
  return unwrap(sdk.getProfiles())
}

// Create-and-activate. Server returns the new state; caller reloads.
export function CreateProfile(name: string): Promise<ProfilesResponse> {
  return unwrap(sdk.createProfile({ body: { name } }))
}

// Onboarding helper: create + seed the sample "test" profile so the
// walkthrough can run on real data. Idempotent (reuses an already-seeded
// "test"). Does NOT switch the active profile — the caller does that via
// SwitchProfile afterwards.
export function SeedTestProfile(): Promise<SeedTestProfileResponse> {
  return unwrap(sdk.seedTestProfile())
}

// Switch the active profile. Returns the new state for callers that want
// to read it before reloading.
export function SwitchProfile(name: string): Promise<ProfilesResponse> {
  return unwrap(sdk.switchProfile({ body: { name } }))
}

// Rename a profile. The server handles the directory rename + the
// active-store close/re-open dance when the renamed profile is active.
export function RenameProfile(oldName: string, newName: string): Promise<ProfilesResponse> {
  return unwrap(sdk.renameProfile({ path: { name: oldName }, body: { new_name: newName } }))
}

// Delete a profile and wipe its directory tree. Cannot target the active
// profile (409). The DELETE echoes nothing (204); the caller refreshes
// the list via the profiles-query invalidation — chasing a GET here would
// turn a transient read failure into a user-facing error for a delete
// that succeeded.
export function DeleteProfile(name: string): Promise<void> {
  return unwrapVoid(sdk.deleteProfile({ path: { name } }))
}

// ─── Coaching session (the coach's side) ───────────────────────────────────
//
// A session is server-side STATE, not a resource the client assembles:
// POST opens it from a bundle's bytes (OpenCoachBundle, on the platform
// seam because it needs a file picker), GET reads it, DELETE ends it and
// discards the loaned records. While one is open every mutating endpoint
// answers 409 — the coach is looking at somebody else's history.

// The open session, hydrated with everything the coach has written about
// this player. Rejects with ApiError 404 when no session is open; the
// query layer maps that to null rather than the banner.
export function GetCoachSession(): Promise<CoachSessionView> {
  return unwrap(sdk.getCoachSession())
}

// End the session and discard the loaned records. Idempotent — closing an
// already-closed session resolves quietly.
export function CloseCoachSession(): Promise<void> {
  return unwrapVoid(sdk.closeCoachSession())
}

// The loaned corpus. These records never touch the coach's database and
// carry no screenshot paths, so nothing resolves against the coach's disk.
export function GetCoachSessionMatches(): Promise<MatchRecord[]> {
  return unwrap(sdk.getCoachSessionMatches())
}

// The bundle suggests a player, the coach confirms (or corrects) one. The
// echoed view carries THAT player's notes, which is how work from an
// earlier session resurfaces.
export function SetCoachSessionPlayer(handle: string): Promise<CoachSessionView> {
  return unwrap(sdk.setCoachSessionPlayer({ body: { handle } }))
}

// The note body as the editor holds it. Deliberately looser than the
// generated CoachNoteInput on one field: focus_tags is `string[]` here
// because the room's draft type is, and the vocabulary is validated
// server-side (a tag outside it is a 400, not a compile error). Widening
// once at the boundary keeps the assertion out of the store and the
// editor.
export interface CoachNoteBody {
  kind:        CoachNoteInput['kind']
  text:        string
  focus_tags:  string[]
  extra_tags:  string[]
  match_clock: string
}

// Upsert the coach's one note about one of the session's matches. The
// autosave target: 404 on a key the loaned corpus doesn't carry, 400 when
// the kind rules are violated (a reviewed-only mark carries no content; a
// note must say or tag something).
export function PutCoachNote(matchKey: string, input: CoachNoteBody): Promise<CoachNote> {
  return unwrap(sdk.putCoachNote({
    path: { match_key: matchKey },
    body: input as CoachNoteInput,
  }))
}

// Clear the coach's note about one match. An emptied draft sends THIS, not
// a PUT with empty fields. Idempotent.
export function DeleteCoachNote(matchKey: string): Promise<void> {
  return unwrapVoid(sdk.deleteCoachNote({ path: { match_key: matchKey } }))
}

// One timestamped moment inside a match's note. The moment id is the
// CLIENT's to mint: the autosave queue keys on it from the first keystroke,
// before any round trip has happened. 400 when the clock is not MM:SS, the
// text is empty, or the match already holds the maximum.
export interface CoachMomentBody {
  match_clock: string
  text: string
  // Widened from the generated enum for the same reason CoachNoteBody widens
  // its tag list: the room's draft type is a string, and the vocabulary is
  // validated server-side, so a tag outside it is a 400 rather than a compile
  // error. Widening once at the boundary keeps the cast out of the store.
  focus_tag?: string
}

export function PutCoachMoment(
  matchKey: string, momentID: string, input: CoachMomentBody,
): Promise<CoachMoment> {
  return unwrap(sdk.putCoachMoment({
    path: { match_key: matchKey, moment_id: momentID },
    body: input as CoachMomentInput,
  }))
}

// Drop one moment. The note stays — a match whose last moment was deleted is
// still a match the coach looked at. Idempotent.
export function DeleteCoachMoment(matchKey: string, momentID: string): Promise<void> {
  return unwrapVoid(sdk.deleteCoachMoment({
    path: { match_key: matchKey, moment_id: momentID },
  }))
}

// The set-level "what to work on" note. An empty string clears it.
export function PutCoachSummary(text: string): Promise<void> {
  return unwrapVoid(sdk.putCoachSummary({ body: { text } }))
}

// One of the PLAYER's own timestamped moments on their own match. The moment
// id is the client's to mint, the same as the coach's. 409 when the id already
// names a moment on a different match, or while a coaching session is open.
export function SetMatchMoment(
  matchKey: string, momentID: string, input: CoachMomentBody,
): Promise<CoachMoment> {
  return unwrap(sdk.setMatchMoment({
    path: { match_key: matchKey, moment_id: momentID },
    body: input as MatchMomentInput,
  }))
}

// Drop one of the player's moments. Idempotent.
export function DeleteMatchMoment(matchKey: string, momentID: string): Promise<void> {
  return unwrapVoid(sdk.deleteMatchMoment({
    path: { match_key: matchKey, moment_id: momentID },
  }))
}

// ─── Coaching returns (the player's side) ──────────────────────────────────

// Every staged notes archive with its per-note decisions so far. Powers
// the Matches banner's "N notes from <coach> waiting".
export function ListCoachReturns(): Promise<CoachReturnSheet[]> {
  return unwrap(sdk.listCoachReturns())
}

export function GetCoachReturn(id: number): Promise<CoachReturnSheet> {
  return unwrap(sdk.getCoachReturn({ path: { id } }))
}

// Discard a staged return. Notes already accepted onto matches stay —
// removing one of those is DeleteMatchCoachNote.
export function DeleteCoachReturn(id: number): Promise<void> {
  return unwrapVoid(sdk.deleteCoachReturn({ path: { id } }))
}

// Record the player's verdicts, keyed by note_id. PARTIAL: only the notes
// named here are decided and an omitted note stays pending, so "Decide
// later" is simply a smaller map. The echoed sheet carries the new state.
export function DecideCoachReturn(
  id: number,
  decisions: Record<string, CoachDecisionEnum>,
): Promise<CoachReturnSheet> {
  return unwrap(sdk.decideCoachReturn({ path: { id }, body: { decisions } }))
}

// Remove one accepted coach block from a match. `id` is the local row
// (MatchCoachNote.id), not the archive-level note_id UUID.
export function DeleteMatchCoachNote(matchKey: string, id: number): Promise<void> {
  return unwrapVoid(sdk.deleteMatchCoachNote({ path: { match_key: matchKey, id } }))
}

// ── Self review ────────────────────────────────────────────────────────
// The player's own saved review sittings over their OWN matches. Not a
// coaching session: no loan, no write gate on the player's data — and the
// note and moment bodies are the coach's shapes on purpose, because the
// room's editor is one component.

export function ListSelfReviews(): Promise<SelfReview[]> {
  return unwrap(sdk.listSelfReviews())
}

export function CreateSelfReview(title: string, matchKeys: string[]): Promise<SelfReview> {
  return unwrap(sdk.createSelfReview({ body: { title, match_keys: matchKeys } }))
}

export function GetSelfReview(reviewID: string): Promise<SelfReview> {
  return unwrap(sdk.getSelfReview({ path: { review_id: reviewID } }))
}

export function UpdateSelfReview(reviewID: string, title: string, summary: string): Promise<SelfReview> {
  return unwrap(sdk.updateSelfReview({ path: { review_id: reviewID }, body: { title, summary } }))
}

export function DeleteSelfReview(reviewID: string): Promise<void> {
  return unwrapVoid(sdk.deleteSelfReview({ path: { review_id: reviewID } }))
}

export function SetSelfReviewMatches(reviewID: string, matchKeys: string[]): Promise<SelfReview> {
  return unwrap(sdk.setSelfReviewMatches({ path: { review_id: reviewID }, body: { match_keys: matchKeys } }))
}

// POST /completion — Finish: stamps the sitting done and every member match
// reviewed by self where a coach has not already. Idempotent.
export function FinishSelfReview(reviewID: string): Promise<SelfReview> {
  return unwrap(sdk.finishSelfReview({ path: { review_id: reviewID } }))
}

export function PutSelfReviewNote(reviewID: string, matchKey: string, input: CoachNoteBody): Promise<SelfReviewNote> {
  return unwrap(sdk.putSelfReviewNote({
    path: { review_id: reviewID, match_key: matchKey },
    body: input as CoachNoteInput,
  }))
}

export function DeleteSelfReviewNote(reviewID: string, matchKey: string): Promise<void> {
  return unwrapVoid(sdk.deleteSelfReviewNote({ path: { review_id: reviewID, match_key: matchKey } }))
}

export function PutSelfReviewMoment(
  reviewID: string, matchKey: string, momentID: string, input: CoachMomentBody,
): Promise<CoachMoment> {
  return unwrap(sdk.putSelfReviewMoment({
    path: { review_id: reviewID, match_key: matchKey, moment_id: momentID },
    body: input as CoachMomentInput,
  }))
}

export function DeleteSelfReviewMoment(reviewID: string, matchKey: string, momentID: string): Promise<void> {
  return unwrapVoid(sdk.deleteSelfReviewMoment({
    path: { review_id: reviewID, match_key: matchKey, moment_id: momentID },
  }))
}

// The two coaching identities, one per direction of the loop: the name this
// user signs notes with as a COACH, and the handle they share under as a
// PLAYER. Server settings, not browser preferences — the exported ledger is
// rendered server-side and the handle is stamped into a bundle's manifest.
// Empty means "not set yet" for either; each side refuses separately.
//
// One pair of functions rather than two, because the PUT carries both: an
// omitted string is indistinguishable from an empty one, so a per-field
// setter could not tell "leave this alone" from "clear this".
export function GetCoachingSettings(): Promise<CoachingSettings> {
  return unwrap(sdk.getCoachingSettings())
}

export function SetCoachingSettings(next: CoachingSettings): Promise<CoachingSettings> {
  return unwrap(sdk.setCoachingSettings({ body: next }))
}

// ─── Database health / maintenance ─────────────────────────────────────────

export function GetDatabaseHealth(): Promise<DBHealth> {
  return unwrap(sdk.getDatabaseHealth())
}

export function RunDatabaseMaintenance(operation: 'optimize' | 'vacuum'): Promise<DBHealth> {
  return unwrap(sdk.runDatabaseMaintenance({ body: { operation } }))
}
