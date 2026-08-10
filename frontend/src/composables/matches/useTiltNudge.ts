import { computed, ref, type Ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import { tiltNudgeSignal, type TiltNudgeSignal } from '@/match/match-momentum-helpers'

// Session state for the tilt nudge: the signal itself is pure
// (match-momentum-helpers.tiltNudgeSignal over the FULL record set —
// tilt is about actual recent play, not the current narrow), and
// dismissal sticks to the streak's first-loss key for the app
// session. The same streak never re-nudges; a fresh streak after a
// win may. Nothing persists — by design, the nudge must not moralize
// across launches.
export function useTiltNudge(records: Readonly<Ref<MatchRecord[]>>) {
  const dismissedStreakKey = ref('')

  const signal = computed<TiltNudgeSignal | null>(() => tiltNudgeSignal(records.value))

  const visibleSignal = computed<TiltNudgeSignal | null>(() => {
    const s = signal.value
    if (!s || s.streakKey === dismissedStreakKey.value) return null
    return s
  })

  function dismiss() {
    if (signal.value) dismissedStreakKey.value = signal.value.streakKey
  }

  return { visibleSignal, dismiss }
}
