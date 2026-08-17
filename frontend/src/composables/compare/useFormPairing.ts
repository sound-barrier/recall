import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import type { Season } from '@/composables/shared/useOWData'
import {
  mirrorPreviousWindow, pairByMatches, pairByTime, samePointWindows, trailingWindow,
  type FormPair, type TimeWindow,
} from '@/match/compare/match-form-slices'

// The Form mode's pairing state machine: which two adjacent windows of
// play get compared (by time or by match count), the preset buttons
// that drive it, and the derived A/B windows + record pair. The view
// destructures this bundle into same-named locals so the template
// stays untouched.

/** What the pairing engine reads from its host view. */
export interface FormPairingOptions {
  /** The visible corpus both windows slice (hidden/unknown stripped). */
  visibleRecords: ComputedRef<MatchRecord[]> | Ref<MatchRecord[]>
  /** Season calendar for the "same point last season" preset. */
  seasons: ComputedRef<Season[]>
}

/** Window sizes the by-matches mode offers. */
export const N_OPTIONS = ['10', '20', '50'] as const

export function useFormPairing(opts: FormPairingOptions) {
  const pairBy = ref<'time' | 'matches'>('time')
  const initial = trailingWindow(7)
  const bFrom = ref(initial.from)
  const bTo = ref(initial.to)
  // The baseline mirrors the picked period by default; unlocking allows any A.
  const aLocked = ref(true)
  const aFrom = ref('')
  const aTo = ref('')
  const nPick = ref('20')
  const activePreset = ref('7d')

  function applyTrailingPreset(days: number, key: string) {
    const w = trailingWindow(days)
    pairBy.value = 'time'
    aLocked.value = true
    bFrom.value = w.from
    bTo.value = w.to
    activePreset.value = key
  }

  function applyMatchesPreset() {
    pairBy.value = 'matches'
    nPick.value = '20'
    activePreset.value = '20m'
  }

  const samePoint = computed(() => samePointWindows(opts.seasons.value))

  function applySamePointPreset() {
    const w = samePoint.value
    if (!w) return
    pairBy.value = 'time'
    aLocked.value = false
    bFrom.value = w.b.from
    bTo.value = w.b.to
    aFrom.value = w.a.from
    aTo.value = w.a.to
    activePreset.value = 'same-point'
  }

  function onManualEdit() {
    activePreset.value = ''
  }

  // Switching pairing modes only clears the preset highlight when the mode
  // actually changes — re-clicking the active mode is a no-op.
  function setPairBy(next: 'time' | 'matches') {
    if (pairBy.value === next) return
    pairBy.value = next
    onManualEdit()
  }

  const bWindow = computed<TimeWindow | null>(() => {
    if (!bFrom.value || !bTo.value || bFrom.value > bTo.value) return null
    return { from: bFrom.value, to: bTo.value }
  })

  const aWindow = computed<TimeWindow | null>(() => {
    const b = bWindow.value
    if (aLocked.value) return b ? mirrorPreviousWindow(b) : null
    if (!aFrom.value || !aTo.value || aFrom.value > aTo.value) return null
    return { from: aFrom.value, to: aTo.value }
  })

  const pair = computed<FormPair>(() => {
    if (pairBy.value === 'matches') {
      return pairByMatches(opts.visibleRecords.value, Number(nPick.value))
    }
    const b = bWindow.value
    const a = aWindow.value
    if (!b || !a) return { a: [], b: [], aWindow: a, bWindow: b, untimed: 0 }
    return pairByTime(opts.visibleRecords.value, b, a)
  })

  return {
    pairBy,
    bFrom,
    bTo,
    aLocked,
    aFrom,
    aTo,
    nPick,
    activePreset,
    applyTrailingPreset,
    applyMatchesPreset,
    samePoint,
    applySamePointPreset,
    onManualEdit,
    setPairBy,
    bWindow,
    aWindow,
    pair,
  }
}
