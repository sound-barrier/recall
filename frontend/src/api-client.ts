import * as realApi from '@/api'

// The single api seam. Every store / composable / SFC imports its api functions
// from HERE instead of '@/api'. Each export delegates to the CURRENT `backing`
// at call time, so a test can swap the whole api via setApiBacking() without the
// module-mock dance (vi.doMock + resetModules + doUnmock) that used to leak a
// hoisted '@/api' mock across Vitest forks and flake App.test. Production never
// reassigns the backing.
//
// Types still live in '@/api'; re-exported here so a consumer can pull functions
// AND types from one path.
export type * from '@/api'

type Api = typeof realApi
let backing: Api = realApi

// Test-only: override api functions for the current test, merged over the real
// module so a partial override leaves the rest intact. The value type is loose
// (`unknown`) because callers pass vi.fn mocks whose inferred types don't match
// the precise api signatures — the production exports below stay fully typed.
// The next test's vi.resetModules() re-evaluates this module, resetting backing.
export function setApiBacking(overrides: Partial<Record<keyof Api, unknown>>): void {
  backing = { ...realApi, ...overrides } as Api
}

// Delegate to backing[name] at CALL time (not import time) — the property that
// defeats the static-import mock leak. Typed to the real signature, so callers
// see the identical contract they had importing from '@/api'.
function bind<K extends keyof Api>(name: K): Api[K] {
  return ((...args: unknown[]) =>
    (backing[name] as (...a: unknown[]) => unknown)(...args)) as Api[K]
}

export const ApplyGameDataUpdate = bind('ApplyGameDataUpdate')
export const BackupDatabase = bind('BackupDatabase')
export const BulkSetMatchPlayMode = bind('BulkSetMatchPlayMode')
export const BulkSetMatchQueue = bind('BulkSetMatchQueue')
export const CancelParse = bind('CancelParse')
export const CheckForUpdate = bind('CheckForUpdate')
export const ClearDatabase = bind('ClearDatabase')
export const ClearIgnoredScreenshots = bind('ClearIgnoredScreenshots')
export const CreateManualMatch = bind('CreateManualMatch')
export const CreateProfile = bind('CreateProfile')
export const DeleteMatchAnnotation = bind('DeleteMatchAnnotation')
export const DeleteProfile = bind('DeleteProfile')
export const EventsOff = bind('EventsOff')
export const EventsOn = bind('EventsOn')
export const ExportBundle = bind('ExportBundle')
export const ExportMatchesCSV = bind('ExportMatchesCSV')
export const GetActiveParse = bind('GetActiveParse')
export const GetDataLocation = bind('GetDataLocation')
export const GetExitOnClose = bind('GetExitOnClose')
export const GetIgnoredScreenshots = bind('GetIgnoredScreenshots')
export const GetMatchResults = bind('GetMatchResults')
export const GetNewScreenshotCount = bind('GetNewScreenshotCount')
export const GetOWData = bind('GetOWData')
export const GetProfiles = bind('GetProfiles')
export const GetScreenshotsDir = bind('GetScreenshotsDir')
export const GetScreenshotsFolderCandidates = bind('GetScreenshotsFolderCandidates')
export const GetScreenshotsFolderCandidateStats = bind('GetScreenshotsFolderCandidateStats')
export const GetStartupError = bind('GetStartupError')
export const GetTesseractStatus = bind('GetTesseractStatus')
export const GetVersion = bind('GetVersion')
export const GetWatchEnabled = bind('GetWatchEnabled')
export const HardDeleteMatch = bind('HardDeleteMatch')
export const IgnoreScreenshot = bind('IgnoreScreenshot')
export const ImportMatches = bind('ImportMatches')
export const MoveMatches = bind('MoveMatches')
export const OpenURL = bind('OpenURL')
export const ParseScreenshots = bind('ParseScreenshots')
export const PickScreenshotsDir = bind('PickScreenshotsDir')
export const PickTesseractBinary = bind('PickTesseractBinary')
export const ProbeTesseractBinary = bind('ProbeTesseractBinary')
export const RenameProfile = bind('RenameProfile')
export const ReParseAll = bind('ReParseAll')
export const ResetMatchData = bind('ResetMatchData')
export const ResetScreenshotsDir = bind('ResetScreenshotsDir')
export const ResetTesseractPath = bind('ResetTesseractPath')
export const ResolveAmbiguousMatch = bind('ResolveAmbiguousMatch')
export const RestoreDatabase = bind('RestoreDatabase')
export const RevealScreenshotsDir = bind('RevealScreenshotsDir')
export const SeedTestProfile = bind('SeedTestProfile')
export const setEventStreamStatusHandler = bind('setEventStreamStatusHandler')
export const SetExitOnClose = bind('SetExitOnClose')
export const SetMatchAnnotation = bind('SetMatchAnnotation')
export const SetMatchPlayMode = bind('SetMatchPlayMode')
export const SetMatchQueue = bind('SetMatchQueue')
export const SetMatchReview = bind('SetMatchReview')
export const SetMatchVisibility = bind('SetMatchVisibility')
export const SetScreenshotsDir = bind('SetScreenshotsDir')
export const SetTesseractPath = bind('SetTesseractPath')
export const SetWatchEnabled = bind('SetWatchEnabled')
export const SwitchProfile = bind('SwitchProfile')
export const UnignoreScreenshot = bind('UnignoreScreenshot')
export const UpdateMatchData = bind('UpdateMatchData')

// ApiError is a class (used with `instanceof`) — re-export the real one, not a
// wrapper, so identity holds for `err instanceof ApiError`.
export { ApiError } from '@/api'
