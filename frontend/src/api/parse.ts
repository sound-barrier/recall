import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type {
  ActiveParse,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

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
