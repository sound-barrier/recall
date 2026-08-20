import { computed, ref, watch, type Ref } from 'vue'

import { buildPaletteItems, type PaletteItem } from '@/match/palette-items'
import type { PaletteActionTarget } from '@/match/palette-items'
import { scoreMatch } from '@/match/palette-score'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useOWData } from '@/composables/shared/useOWData'
import { latestSessionKeys } from '@/match/dossier/match-momentum-helpers'
import { useCoachStore } from '@/stores/coach'
import { useSelfReviewStore } from '@/stores/selfReview'
import { useUiStore } from '@/stores/ui'
import { useWriteGate } from '@/composables/shared/useWriteGate'

// Enough to fill the list without scoring the reader's patience. The corpus is
// already capped upstream; this caps what is DRAWN.
const MAX_RESULTS = 12

export interface PaletteResult extends PaletteItem {
  hits: number[]
}

/**
 * The command palette's state and behavior.
 *
 * The corpus is a computed over the records, NOT rebuilt per keystroke: typing
 * re-scores, it does not re-derive. Scoring a few hundred short strings on each
 * character is cheap; rebuilding the item list from every match would not be.
 */
export function useCommandPalette(): {
  query: Ref<string>
  results: Ref<PaletteResult[]>
  cursor: Ref<number>
  move: (delta: number) => void
  run: (item?: PaletteResult) => boolean
  close: () => void
} {
  const app = useAppStore()
  const matches = useMatchesStore()
  const ui = useUiStore()
  const ow = useOWData()
  const coach = useCoachStore()
  const { writesLocked, guardWrite } = useWriteGate()

  const query = ref('')
  const cursor = ref(0)

  // The corpus comes from narrowedRecords, NOT from every record, because the
  // detail panel paginates against exactly that list. Offering a match outside
  // it opened the panel with no record behind it: nothing renders, but the page
  // is marked inert — a window that silently stops responding with no visible
  // modal to close. Searching the set the user is looking at is also the
  // honest reading of the feature.
  const corpus = computed(() => buildPaletteItems(
    matches.matchesNarrow.narrowedRecords.value,
    { hero: ow.heroDisplayName, map: ow.mapDisplayName },
    coach.sessionActive,
    writesLocked.value,
  ))

  const results = computed<PaletteResult[]>(() => {
    const scored: (PaletteResult & { score: number })[] = []
    for (const item of corpus.value) {
      const hit = scoreMatch(query.value, item.label)
      if (hit) scored.push({ ...item, hits: hit.hits, score: hit.score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, MAX_RESULTS)
  })

  // Typing returns the highlight to the top. Leaving it where it was put the
  // cursor past the end of a shorter list, where nothing renders as selected
  // (no aria-activedescendant either) while Enter still ran the last row — an
  // action on a result the user was never pointed at.
  watch(query, () => { cursor.value = 0 })

  function move(delta: number) {
    const n = results.value.length
    if (n === 0) return
    cursor.value = (cursor.value + delta + n) % n
  }

  function close() {
    ui.closePalette()
    query.value = ''
    cursor.value = 0
  }

  // One dispatch per kind, as a lookup rather than a switch, so a new kind is
  // an entry instead of an edit here. Keyed on the KIND UNION rather than
  // `string`: that is what makes a new kind a compile error here instead of an
  // Enter press that silently does nothing.
  const RUNNERS: Record<PaletteItem['kind'], (target: string) => void> = {
    view: (target) => { void app.goToView(target) },
    match: (target) => {
      void app.goToView('matches')
      ui.selection.open(target)
    },
    // Actions run rather than navigate. Both coaching entries land the user
    // where the affordance already lives instead of duplicating it: the
    // palette is a way to FIND the feature, not a second implementation of it.
    action: (target) => {
      // A target with no runner does NOTHING. It used to fall out of an
      // if/else into the share dialog, so an entry the palette could not run
      // put a file holding every teammate's BattleTag in front of the user.
      if (isActionTarget(target)) void ACTION_RUNNERS[target]()
    },
  }

  // Keyed on the action-target union for the same reason RUNNERS is keyed on
  // the kind union: adding an ACTION_ITEM without wiring it here does not
  // compile.
  const ACTION_RUNNERS: Record<PaletteActionTarget, () => Promise<void>> = {
    'open-bundle': () => coach.openBundle(),
    'send-to-coach': sendTheNarrowedSet,
    'review-last-session': reviewLastSession,
  }

  // The same start the Reviews tab's 01 block offers, from a keystroke. On
  // an empty history there is nothing to open a sitting over — landing on
  // the tab that says so beats silently doing nothing.
  async function reviewLastSession(): Promise<void> {
    // Belt to the corpus filter's suspenders — a stale result list could
    // still offer the entry for one render after the lock flipped.
    if (!guardWrite()) return
    const keys = latestSessionKeys(matches.records.filter((r) => !r.hidden))
    if (keys.length === 0) {
      await app.goToView('reviews')
      return
    }
    await useSelfReviewStore().createFromKeys(keys)
  }

  function isActionTarget(target: string): target is PaletteActionTarget {
    return Object.hasOwn(ACTION_RUNNERS, target)
  }

  // The set on screen. The dialog names every match going out, so it no
  // longer has to drag the user to Matches to make "N matches" mean
  // something — which is why this stopped navigating.
  function sendTheNarrowedSet(): Promise<void> {
    matches.requestShare(
      matches.matchesNarrow.narrowedRecords.value.map((r) => r.match_key),
      'narrow',
    )
    return Promise.resolve()
  }

  // Returns whether anything ran, so the caller can leave the palette open on
  // an Enter that had nothing to act on — closing it there would discard a
  // query the user is still in the middle of typing.
  function run(item?: PaletteResult): boolean {
    const chosen = item ?? results.value[cursor.value]
    if (!chosen) return false
    RUNNERS[chosen.kind](chosen.target)
    close()
    return true
  }

  return { query, results, cursor, move, run, close }
}
