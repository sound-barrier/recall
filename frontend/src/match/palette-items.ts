import type { MatchRecord } from '@/api-client'

// Only what the corpus actually reads. Narrow on purpose: a full MatchRecord
// would force every caller and every fixture to satisfy fields this never
// touches.
type PaletteRecord = Pick<MatchRecord, 'match_key' | 'data'>
import { TAB_LABELS, TAB_ORDER } from '@/composables/shared/keyboard/useTabKeyboardNav'
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
type PaletteKind = 'view' | 'match' | 'action'

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



/**
 * Things the palette can DO, as opposed to places it can go.
 *
 * The coaching entries are here because coaching had no discoverable surface
 * at all: not a tab, not a palette entry, and the coach's only door was the
 * fifth item of a dropdown behind a chip labeled with a profile name. An
 * action is what the typed runner registry was built to allow — a third kind
 * is an entry here plus a runner, not an edit to a switch.
 */
/**
 * The targets an action can carry. A union rather than `string` so the runner
 * map in useCommandPalette is exhaustive by the type checker — a new entry
 * below without a runner is a compile error, not an Enter press that opens
 * whichever branch happened to be last.
 */
export type PaletteActionTarget = 'share-with-coach' | 'open-bundle' | 'review-last-session'

export const ACTION_ITEMS: readonly (PaletteItem & { target: PaletteActionTarget })[] = [
  {
    id: 'action:review-last-session',
    kind: 'action',
    label: 'Review my last session',
    hint: 'Your own film room',
    target: 'review-last-session',
  },
  {
    id: 'action:share-with-coach',
    kind: 'action',
    label: 'Share matches with a coach',
    hint: 'Export a bundle',
    target: 'share-with-coach',
  },
  {
    id: 'action:open-bundle',
    kind: 'action',
    label: "Open a player's bundle",
    hint: 'Review someone else',
    target: 'open-bundle',
  },
] as const

export function viewItems(): PaletteItem[] {
  return TAB_ORDER.map((id) => ({
    id: `view:${id}`,
    kind: 'view' as const,
    label: TAB_LABELS[id],
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
export function matchItems(
  records: readonly PaletteRecord[],
  names: DisplayNames = {},
  limit = 300,
): PaletteItem[] {
  // Display names, not the stored slugs. Every other surface in the app shows
  // "Soldier: 76" and "King's Row"; a palette row reading `soldier 76 ·
  // king's row` looks like debug output beside them. The resolvers are passed
  // in rather than imported so this module stays free of the reference-data
  // fetch and testable without a Pinia instance.
  const hero_ = names.hero ?? ((v: string) => v)
  const map_ = names.map ?? ((v: string) => v)
  return [...records]
    .sort((a, b) => matchTime(b).localeCompare(matchTime(a)))
    .slice(0, limit)
    .map((r) => {
      const hero = hero_(r.data?.hero ?? '')
      const map = map_(r.data?.map ?? '')
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

/** Resolvers for the canonical display names, both optional. */
export interface DisplayNames {
  hero?: (slug: string) => string
  map?: (slug: string) => string
}

/**
 * @param inCoachingSession suppresses the coaching actions. Inside the Film
 * Room the corpus is somebody else's matches, so "Share matches with a coach"
 * would open the share dialog over the loaned set, and "Open a player's
 * bundle" is a 409 — one session at a time. An entry that cannot do its job
 * is worse than no entry: it was added to make the feature findable, and a
 * dead end teaches the opposite.
 */
export function buildPaletteItems(
  records: readonly PaletteRecord[],
  names: DisplayNames = {},
  inCoachingSession = false,
): PaletteItem[] {
  const actions = inCoachingSession ? [] : ACTION_ITEMS
  return [...viewItems(), ...actions, ...matchItems(records, names)]
}
