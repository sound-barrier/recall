import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type {
  ManualMatchInput,
  MatchRecord,
  UserMatchDataInput,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

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

// Dismiss / restore a match's reference-data-gap warning. The match is
// untouched — only the Unknown tab's gap card moves behind (or back out
// of) its "N acknowledged" disclosure. Both directions idempotent.
export function AcknowledgeReferenceGap(matchKey: string): Promise<void> {
  return unwrapVoid(sdk.acknowledgeReferenceGap({ path: { match_key: matchKey } }))
}

export function UnacknowledgeReferenceGap(matchKey: string): Promise<void> {
  return unwrapVoid(sdk.unacknowledgeReferenceGap({ path: { match_key: matchKey } }))
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
