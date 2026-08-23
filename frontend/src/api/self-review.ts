import { unwrap, unwrapVoid } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type { CoachMomentBody, CoachNoteBody } from '@/api/coach-session'
import type {
  CoachingSettings,
  CoachMoment,
  CoachMomentInput,
  CoachNoteInput,
  CoachPlayerSummary,
  FocusItem,
  SelfReview,
  SelfReviewNote,
  ShareExport,
} from '@/client/types.gen'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

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

export function UpdateSelfReview(reviewID: string, title: string): Promise<SelfReview> {
  return unwrap(sdk.updateSelfReview({ path: { review_id: reviewID }, body: { title } }))
}

/** What the sitting concluded, in the player's order. */
export function SetSelfReviewFocusItems(reviewID: string, items: FocusItem[]): Promise<SelfReview> {
  return unwrap(sdk.setSelfReviewFocusItems({ path: { review_id: reviewID }, body: { items } }))
}

/** The coach's roster — every player this user has coached, newest work first. */
export function ListCoachPlayers(): Promise<CoachPlayerSummary[]> {
  return unwrap(sdk.listCoachPlayers())
}

/** The sent ledger — every share-with-a-coach export, newest first. */
export function ListShareExports(): Promise<ShareExport[]> {
  return unwrap(sdk.listShareExports())
}

/** Replace the sitting's match set; a note on a match that leaves goes with it. */
export function SetSelfReviewMatches(reviewID: string, matchKeys: string[]): Promise<SelfReview> {
  return unwrap(sdk.setSelfReviewMatches({ path: { review_id: reviewID }, body: { match_keys: matchKeys } }))
}

export function DeleteSelfReview(reviewID: string): Promise<void> {
  return unwrapVoid(sdk.deleteSelfReview({ path: { review_id: reviewID } }))
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
