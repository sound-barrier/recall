import { computed, ref, type Ref } from 'vue'

import { buildPaletteItems, type PaletteItem } from '@/match/palette-items'
import { scoreMatch } from '@/match/palette-score'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'

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
  run: (item?: PaletteResult) => void
  close: () => void
} {
  const app = useAppStore()
  const matches = useMatchesStore()
  const ui = useUiStore()

  const query = ref('')
  const cursor = ref(0)

  const corpus = computed(() => buildPaletteItems(matches.records))

  const results = computed<PaletteResult[]>(() => {
    const scored: (PaletteResult & { score: number })[] = []
    for (const item of corpus.value) {
      const hit = scoreMatch(query.value, item.label)
      if (hit) scored.push({ ...item, hits: hit.hits, score: hit.score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, MAX_RESULTS)
  })

  // The cursor is clamped on read rather than watched: results change on every
  // keystroke, and a stale index would either render nothing selected or run
  // the wrong row on Enter.
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
  // an entry instead of an edit here.
  const RUNNERS: Record<string, (target: string) => void> = {
    view: (target) => { void app.goToView(target) },
    match: (target) => {
      void app.goToView('matches')
      ui.selection.open(target)
    },
  }

  function run(item?: PaletteResult) {
    const chosen = item ?? results.value[Math.min(cursor.value, results.value.length - 1)]
    if (!chosen) return
    RUNNERS[chosen.kind]?.(chosen.target)
    close()
  }

  return { query, results, cursor, move, run, close }
}
