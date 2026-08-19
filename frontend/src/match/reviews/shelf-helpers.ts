import type { MatchRecord, SelfReview } from '@/api'
import { tallyWLD, type WLDTally } from '@/match/match-stats-helpers'

// What a shelf card says about a sitting, derived once from the sitting and
// the player's records. The mini sprocket rail is the reel's own rail at
// label size: one perforation per member, carrying the same mark the full
// reel uses — filled where a note was written, hollow where the match was
// only looked at, bare where nothing yet — so how much of the sitting is
// written up reads at a glance, and the card's name says it in words.

export type RailMark = 'written' | 'reviewed' | 'bare'

export interface ShelfCard {
  reviewId: string
  /** The sitting's title, or a day-based fallback when it has none. */
  title: string
  /** 'YYYY-MM-DD' the sitting was opened. */
  dayKey: string
  finished: boolean
  matchCount: number
  wld: WLDTally
  /** One mark per member, in the sitting's order. */
  rail: RailMark[]
  writtenCount: number
  summaryExcerpt: string
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
    wld: tallyWLD(members),
    rail,
    writtenCount: rail.filter((m) => m === 'written').length,
    summaryExcerpt: excerpt(sitting.summary),
  }
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if ([...flat].length <= EXCERPT_RUNES) return flat
  return [...flat].slice(0, EXCERPT_RUNES - 1).join('').trimEnd() + '…'
}

/** "4 matches · 2 noted · 3–1" — the card's spoken summary. */
export function shelfCardSpokenState(card: ShelfCard): string {
  const matches = `${card.matchCount} ${card.matchCount === 1 ? 'match' : 'matches'}`
  const noted = `${card.writtenCount} noted`
  const record = `${card.wld.w}–${card.wld.l}${card.wld.d ? `–${card.wld.d}` : ''}`
  return `${matches} · ${noted} · ${record} · ${card.finished ? 'finished' : 'in progress'}`
}
