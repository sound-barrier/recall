import { ref, onMounted } from 'vue'

export type LeaverHandling = 'include' | 'exclude-tally' | 'hide'
export const LEAVER_HANDLING_STORAGE_KEY = 'recall.leaverHandling'

// Persisted preference for how to treat matches the user has tagged
// with a leaver scenario (self / team / enemy):
//
//   - 'include'        — the default. Match is visible AND its
//                        win/loss/draw counts toward the W/L/D tally.
//   - 'exclude-tally'  — match stays visible in the list, but its
//                        result is omitted from the W/L/D tally so
//                        the win-rate reflects "real" games only.
//   - 'hide'           — match is dropped from the list entirely
//                        (which also means it doesn't count toward
//                        the tally). Useful for users who don't want
//                        leaver-affected matches in their library at
//                        all.
//
// Same shape as useTheme / useWeekStart / useIncludeUndated /
// useDensityMode — readStored*, set*, onMounted hydrator.
export function readStoredLeaverHandling(): LeaverHandling {
  try {
    const stored = localStorage.getItem(LEAVER_HANDLING_STORAGE_KEY)
    if (stored === 'include' || stored === 'exclude-tally' || stored === 'hide') return stored
  } catch (_) {}
  return 'include'
}

export function useLeaverHandling() {
  const leaverHandling = ref<LeaverHandling>('include')

  function setLeaverHandling(next: LeaverHandling) {
    leaverHandling.value = next
    try { localStorage.setItem(LEAVER_HANDLING_STORAGE_KEY, next) } catch (_) {}
  }

  onMounted(() => {
    leaverHandling.value = readStoredLeaverHandling()
  })

  return { leaverHandling, setLeaverHandling }
}
