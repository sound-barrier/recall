/**
 * The wire surface, one module per endpoint family.
 *
 * This was a single 865-line file with 97 one-call wrappers. It was accepted
 * once at 529 lines as "the one-page wire-surface listing", which stopped being
 * true a long way back (TECHNICAL_DEBT.md section 18). The section comments
 * that divided it are now real module boundaries.
 *
 * Consumers are unaffected: api-client.ts does `import * as realApi from
 * "@/api"`, and the fourteen files that import types from here keep working,
 * because this barrel re-exports everything the flat file exported.
 */

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.
export type {
  ActiveParse,
  AutoBackupStatus,
  CoachDecisionEnum,
  CoachingSettings,
  CoachFocusTagEnum,
  CoachMatchContext,
  CoachMoment,
  CoachNote,
  CoachNoteInput,
  CoachNoteKindEnum,
  CoachPlayer,
  CoachReturnItem,
  CoachReturnSheet,
  CoachReturnStatus,
  CoachSessionChangedEvent,
  CoachSessionView,
  ObservedContext,
  MatchCoachNote,
  MatchSelfReviewNote,
  CoachPlayerSummary,
  FocusEntry,
  FocusItem,
  FocusStatus,
  SelfReview,
  ShareExport,
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


// The platform-bound surface (native dialogs, events, OpenURL, binary
// import/export) is re-exported so '@/api' keeps its full historical
// export surface — api-client.ts binds every name from here.
export {
  BackupDatabase,
  EventsOff,
  EventsOn,
  ExportBundle,
  ExportCoachNotes,
  ExportCoachSheet,
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

export * from '@/api/types'
export * from '@/api/system'
export * from '@/api/matches-read'
export * from '@/api/matches-write'
export * from '@/api/suppress-list'
export * from '@/api/parse'
export * from '@/api/settings'
export * from '@/api/profiles'
export * from '@/api/coach-session'
export * from '@/api/coach-returns'
export * from '@/api/self-review'
export * from '@/api/db-health'
