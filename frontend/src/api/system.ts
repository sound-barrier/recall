import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type { OWData, ParseStaleness } from '@/api/types'
import type {
  UpdateInfo,
  DataUpdateResult,
  DataLocation,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

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
