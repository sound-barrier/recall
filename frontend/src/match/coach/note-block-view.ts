import type { CoachMoment, MatchCoachNote, MatchSelfReviewNote } from '@/api-client'
import { formatPlayerDay } from '@/match/coach/coach-time'

// The one shape a note block on a match renders from, whichever family the
// note came from. A coach's block and the player's own sitting's block say
// different things about WHO wrote them and what "remove" does — the rest is
// the same paper: text or a mark, a clock, moments, tags, a signature. The
// block component reads this and nothing else; the two builders below say
// where each word comes from.

/** What dropping the block does — the two families are removed through different stores. */
export type NoteBlockRemoval
  = { kind: 'coach'; id: number }
  | { kind: 'self'; reviewId: string }

export interface NoteBlockView {
  /** The a11y name and the eyebrow: "Coach's note from Ordo" / "Your review". */
  heading: string
  /** The paper chip beside it: "Reviewed by coach" / "In progress" / "Finished". */
  status: string
  text: string
  matchClock: string
  moments: CoachMoment[]
  tags: string[]
  /** The signature line under the block. */
  sign: string
  removeLabel: string
  removal: NoteBlockRemoval
}

export function coachBlockView(note: MatchCoachNote): NoteBlockView {
  return {
    heading: `Coach's note from ${note.coach_name}`,
    status: 'Reviewed by coach',
    text: note.text,
    matchClock: note.match_clock ?? '',
    moments: note.moments ?? [],
    tags: [...(note.focus_tags ?? []), ...(note.extra_tags ?? [])],
    sign: `— ${note.coach_name} · ${note.session_date}`,
    removeLabel: 'Remove this note',
    removal: { kind: 'coach', id: note.id },
  }
}

// The sitting's title is the block's name when it has one; the day it was
// opened otherwise — the same identity the shelf card carries.
export function selfBlockView(note: MatchSelfReviewNote): NoteBlockView {
  const day = formatPlayerDay(note.review_created_at.slice(0, 10))
  const title = note.review_title?.trim() ?? ''
  return {
    heading: 'Your review',
    status: note.review_finished_at ? 'Finished' : 'In progress',
    text: note.text,
    matchClock: note.match_clock ?? '',
    moments: note.moments ?? [],
    tags: [...(note.focus_tags ?? []), ...(note.extra_tags ?? [])],
    sign: `— ${title || 'Your review'} · ${day}`,
    removeLabel: 'Remove from this review',
    removal: { kind: 'self', reviewId: note.review_id },
  }
}
