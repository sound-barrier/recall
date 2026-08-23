import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type {
  CoachDecisionEnum,
  CoachReturnSheet,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

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
