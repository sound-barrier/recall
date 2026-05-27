import { usePersistedRef, parseEnum } from './usePersistedRef'

export type LeaverHandling = 'include' | 'exclude-tally' | 'hide'
export const LEAVER_HANDLING_STORAGE_KEY = 'recall.leaverHandling'

// Persisted preference for how to treat matches the user has tagged
// with a leaver scenario (self / team / enemy):
//
//   - 'include'        — the default. Match visible AND its
//                        win/loss/draw counts toward the tally.
//   - 'exclude-tally'  — match stays visible in the list, but its
//                        result is omitted from the W/L/D tally so
//                        the win-rate reflects "real" games only.
//   - 'hide'           — match dropped from the list entirely
//                        (which also means it doesn't count toward
//                        the tally).

const parseLeaver = parseEnum<LeaverHandling>('include', 'exclude-tally', 'hide')

export function readStoredLeaverHandling(): LeaverHandling {
  try {
    const stored = localStorage.getItem(LEAVER_HANDLING_STORAGE_KEY)
    return parseLeaver(stored ?? '') ?? 'include'
  } catch (_) {
    return 'include'
  }
}

export function useLeaverHandling() {
  const { value: leaverHandling, set: setLeaverHandling } = usePersistedRef<LeaverHandling>({
    key: LEAVER_HANDLING_STORAGE_KEY,
    defaultValue: 'include',
    parse: parseLeaver,
  })
  return { leaverHandling, setLeaverHandling }
}
