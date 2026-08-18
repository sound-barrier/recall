import type { MatchRecord } from '@/api-client'

// Only what the corpus actually reads. Narrow on purpose: a full MatchRecord
// would force every caller and every fixture to satisfy fields this never
// touches.
type PaletteRecord = Pick<MatchRecord, 'match_key' | 'data'>
import { TAB_ORDER } from '@/composables/shared/keyboard/useTabKeyboardNav'
import { matchTime } from '@/match/match-time-helpers'

/**
 * The command palette's searchable corpus.
 *
 * Pure and store-free: it takes the records it should offer and returns items
 * with a `kind` the caller dispatches on. Keeping the dispatch OUT of here is
 * what lets this be unit-tested without a Pinia instance, and what keeps the
 * palette from growing a second copy of the app's navigation rules.
 */

// Not exported: the kind is consumed through PaletteItem, and the runner
// registry keys off it structurally.
type PaletteKind = 'view' | 'match'

export interface PaletteItem {
  id: string
  kind: PaletteKind
  // What the scorer matches against and the row renders.
  label: string
  // Secondary line — never scored, because a hit the user cannot see in the
  // label reads as a random result.
  hint: string
  // Payload the caller needs to act: a view id, or a match key.
  target: string
}

// The tabs, by their user-facing names. Derived from TAB_ORDER so a new tab
// cannot silently miss the palette; the label map is asserted complete by a
// test rather than trusted.
const VIEW_LABELS: Record<string, string> = {
  settings: 'Settings',
  ingest: 'Parse',
  matches: 'Matches',
  unknown: 'Unknown',
  compare: 'Compare',
  elo: 'Elo Calculator',
}

export function viewItems(): PaletteItem[] {
  return TAB_ORDER.map((id) => ({
    id: `view:${id}`,
    kind: 'view' as const,
    label: VIEW_LABELS[id] ?? id,
    hint: 'Go to view',
    target: id,
  }))
}

/**
 * One item per match, labeled the way a player remembers a game: the hero and
 * map, then when.
 *
 * Capped, and the cap is the point — a palette over a 5,000-match history that
 * scored every record on every keystroke would be a stutter, and nobody scrolls
 * past the first handful of results anyway. Newest first, because the match a
 * player is looking for is almost always a recent one.
 */
export function matchItems(records: readonly PaletteRecord[], limit = 300): PaletteItem[] {
  return [...records]
    .sort((a, b) => matchTime(b).localeCompare(matchTime(a)))
    .slice(0, limit)
    .map((r) => {
      const hero = r.data?.hero ?? ''
      const map = r.data?.map ?? ''
      const when = r.data?.date ?? ''
      return {
        id: `match:${r.match_key}`,
        kind: 'match' as const,
        // Both names in the label so either one finds it — a player searching
        // "rialto" and one searching "juno" are looking for the same game.
        label: [hero, map].filter(Boolean).join(' · ') || r.match_key,
        hint: [when, r.data?.result].filter(Boolean).join(' · '),
        target: r.match_key,
      }
    })
}

export function buildPaletteItems(records: readonly PaletteRecord[]): PaletteItem[] {
  return [...viewItems(), ...matchItems(records)]
}
