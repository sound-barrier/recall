import { computed, type ComputedRef } from 'vue'

import { useWriteGate } from '@/composables/shared/useWriteGate'
import type { ClockMode } from '@/match/match-time-helpers'

// Which clock this surface renders match times in.
//
// Design rule 7: a coaching session loans another player's records, and
// session time is player-naive EVERYWHERE — the film room and the
// step-into views alike. `fmtTime` / `formatRowDate` / `formatFinishedAt`
// take the mode; this is the one place the app decides what it is, so a
// row can never print a day the grouping disagrees with (grouping, the
// date filter and the heatmap all bucket on the naive `data.date`).
//
// Reads the write gate rather than the coach store directly: `sessionActive`
// is already the gate's public word for "these records are on loan", and
// leaf rows that merely need the mode should not drag a store into their
// chunk — or into their unit tests.

/** The clock mode for the records currently on screen. */
export function useMatchClock(): ComputedRef<ClockMode> {
  const { sessionActive } = useWriteGate()
  return computed(() => (sessionActive.value ? 'player' : 'viewer'))
}
