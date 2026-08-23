import { unwrap } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type {
  MatchRecord,
  FailedFile,
  IgnoredScreenshot,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

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
