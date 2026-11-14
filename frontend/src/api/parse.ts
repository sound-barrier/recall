import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type {
  ActiveRun,
  ParseAccepted,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

// ─── Parse pipeline ────────────────────────────────────────────────────────

// Starts a parse and answers with its run id — the id its parse-progress
// and run-finished events carry.
export function ParseScreenshots(): Promise<ParseAccepted> {
  return unwrap(sdk.parseScreenshots())
}

// ReParseAll re-runs OCR on every PNG in the watched folder, including
// files already in the DB. The Upsert is idempotent on filename so the
// user's annotations / queue / play-mode / hidden / review state survive.
export function ReParseAll(): Promise<ParseAccepted> {
  return unwrap(sdk.parseScreenshots({ query: { scope: 'all' } }))
}

// Cancel an in-flight parse. The OCR loop checks ctx.Err() between
// screenshots. The run's `run-finished` event (outcome `canceled`) flips the
// Stop button back; a 409 (the run already ended, or the slot is held by a
// store swap that cannot be stopped) rejects with ApiError.
export function CancelParse(): Promise<void> {
  return unwrapVoid(sdk.cancelParse())
}

// Run-slot snapshot — the resync anchor for the async parse pipeline. A
// client that reconnects or reloads mid-run reads this to restore "is
// something running, what, and how far along".
export function GetActiveParse(): Promise<ActiveRun> {
  return unwrap(sdk.getActiveParse())
}
