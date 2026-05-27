import { usePersistedRef } from './usePersistedRef'
import type { WeekStart } from '../match-helpers'

export type { WeekStart }
export const WEEK_START_STORAGE_KEY = 'recall.weekStart'

// Persisted preference for the first day of the week — drives the
// Month → Week → Day grouping's "Week of <date>" labels. Any day 0-6
// (per JS Date.getDay(): 0=Sun … 6=Sat). Default 0 (Sunday) matches
// the US locale convention.
//
// Migrates the legacy string values "sunday" / "monday" from the
// previous binary toggle to 0 / 1 transparently.

function parseWeekStart(raw: string): WeekStart | undefined {
  if (raw === 'sunday') return 0
  if (raw === 'monday') return 1
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
