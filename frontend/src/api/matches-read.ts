import { unwrap } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type {
  MatchRecord,
  FailedFile,
  FieldRegion,
  IgnoredScreenshot,
  GetPendingScreenshotCountResponse,
  LikelyCause,
  ReportFile,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

// ─── Matches (read) ────────────────────────────────────────────────────────

export function GetMatchResults(): Promise<MatchRecord[]> {
  return unwrap(sdk.getMatchResults())
}

// Where on the match's own screenshots each field was read — fetched on
// demand by the flagged-reading review, never with the list.
export async function GetMatchFieldRegions(matchKey: string): Promise<FieldRegion[]> {
  const reply = await unwrap(sdk.getMatchFieldRegions({ path: { match_key: matchKey } }))
  return reply.regions
}

export type PendingScreenshots = GetPendingScreenshotCountResponse

// Count of screenshots the next parse run will OCR, plus the on-disk
// files parked after repeated failures (skipped by normal runs) and the
// ones another profile owns.
export function GetNewScreenshotCount(): Promise<PendingScreenshots> {
  return unwrap(sdk.getPendingScreenshotCount())
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

// What is likely wrong with the picked files or the Tesseract install — the
// fixes the parse-problem report dialog offers before the user saves.
export async function PreflightDiagnosticBundle(files: ReportFile[]): Promise<LikelyCause[]> {
  const reply = await unwrap(sdk.preflightDiagnosticBundle({ body: { files } }))
  return reply.likely_causes
}
