import { usePersistedRef } from '@/composables/usePersistedRef'
import type { WeekStart } from '@/match-time-helpers'

export type { WeekStart }
export const WEEK_START_STORAGE_KEY = 'recall.weekStart'

// Persisted preference for the first day of the week — drives the
// Month → Week → Day grouping's "Week of <date>" labels. Any day 0-6
// (per JS Date.getDay(): 0=Sun … 6=Sat). Default 0 (Sunday) matches
// the US locale convention.

function parseWeekStart(raw: string): WeekStart | undefined {
  const n = Number(raw)
  if (Number.isInteger(n) && n >= 0 && n <= 6) return n as WeekStart
  return undefined
}

export function readStoredWeekStart(): WeekStart {
  try {
    const raw = localStorage.getItem(WEEK_START_STORAGE_KEY)
    return parseWeekStart(raw ?? '') ?? 0
  } catch (_) {
    return 0
  }
}

export function useWeekStart() {
  const { value: weekStart, set: setWeekStart } = usePersistedRef<WeekStart>({
    key: WEEK_START_STORAGE_KEY,
    defaultValue: 0,
    parse: parseWeekStart,
  })
  return { weekStart, setWeekStart }
}
