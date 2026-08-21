import type { MatchRecord, SelfReview } from '@/api'
import { tallyWLD, type WLDTally } from '@/match/match-stats-helpers'
import { pluralize } from '@/match/reviews/reviews-helpers'

// What a shelf card says about a sitting, derived once from the sitting and
// the player's records. The mini sprocket rail is the reel's own rail at
// label size: one perforation per member, carrying the same mark the full
// reel uses — filled where a note was written, hollow where the match was
// only looked at, bare where nothing yet — so how much of the sitting is
// written up reads at a glance, and the card's name says it in words.

type RailMark = 'written' | 'reviewed' | 'bare'

export interface ShelfCard {
  reviewId: string
  /** The sitting's title, or a day-based fallback when it has none. */
  title: string
  /** 'YYYY-MM-DD' the sitting was opened. */
  dayKey: string
  finished: boolean
  matchCount: number
  /** Members the history no longer holds (hard-deleted since). */
  missingCount: number
  /** Every member, for "Show these matches". */
  matchKeys: string[]
  wld: WLDTally
  /** One mark per member, in the sitting's order. */
  rail: RailMark[]
  writtenCount: number
  /** What the sitting concluded, joined into one line for the card. */
  focusExcerpt: string
}

const EXCERPT_RUNES = 140

export function shelfCard(sitting: SelfReview, records: readonly MatchRecord[]): ShelfCard {
  const byKey = new Map(records.map((r) => [r.match_key, r]))
  const members = sitting.match_keys.flatMap((k) => { const r = byKey.get(k); return r ? [r] : [] })
  const rail = sitting.match_keys.map((k): RailMark => {
    const note = sitting.notes[k]
    if (!note) return 'bare'
    return note.kind === 'reviewed_only' || !note.text.trim() ? 'reviewed' : 'written'
  })
  return {
    reviewId: sitting.review_id,
    title: sitting.title.trim() || `Review of ${sitting.created_at.slice(0, 10)}`,
    dayKey: sitting.created_at.slice(0, 10),
    finished: Boolean(sitting.finished_at),
    matchCount: sitting.match_keys.length,
    missingCount: sitting.match_keys.length - members.length,
    matchKeys: [...sitting.match_keys],
    wld: tallyWLD(members),
    rail,
    writtenCount: rail.filter((m) => m === 'written').length,
    focusExcerpt: excerpt(sitting.focus_items.map((i) => i.text).join(" · ")),
  }
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if ([...flat].length <= EXCERPT_RUNES) return flat
  return [...flat].slice(0, EXCERPT_RUNES - 1).join('').trimEnd() + '…'
}

/**
 * "4 matches · 2 with notes · 3–1 · finished" — the card's spoken summary.
 * A card whose members have left the history says so, or its tally reads
 * as a lie ("3 matches · 0–0").
 */
export function shelfCardSpokenState(card: ShelfCard): string {
  const matches = pluralize(card.matchCount, 'match', 'matches')
  const noted = `${card.writtenCount} with notes`
  const record = `${card.wld.w}–${card.wld.l}${card.wld.d ? `–${card.wld.d}` : ''}`
  const gone = card.missingCount > 0
    ? ` · ${card.missingCount} no longer in your history`
    : ''
  return `${matches} · ${noted} · ${record} · ${card.finished ? 'finished' : 'in progress'}${gone}`
}
