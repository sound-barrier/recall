import { ref, onMounted } from 'vue'
import type { WeekStart } from '../match-helpers'

export type { WeekStart }
export const WEEK_START_STORAGE_KEY = 'recall.weekStart'

// Persisted preference for the first day of the week — drives the
// Month → Week → Day grouping's "Week of <date>" labels. Any day 0-6
// (per JS Date.getDay(): 0=Sun … 6=Sat). Default 0 (Sunday) matches
// the US locale convention; users in ISO-8601 regions, the Middle East
// (Saturday-start, Friday-start), or anywhere else can pick their own.
//
// Reads/writes localStorage to survive across launches. The legacy
// string values "sunday" and "monday" from the previous binary toggle
// are migrated to 0 and 1 transparently.
export function readStoredWeekStart(): WeekStart {
  try {
    const raw = localStorage.getItem(WEEK_START_STORAGE_KEY)
    if (raw === null) return 0
    if (raw === 'sunday') return 0
    if (raw === 'monday') return 1
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0 && n <= 6) return n as WeekStart
  } catch (_) {}
  return 0
}

export function useWeekStart() {
  const weekStart = ref<WeekStart>(0)

  function setWeekStart(next: WeekStart) {
    weekStart.value = next
    try { localStorage.setItem(WEEK_START_STORAGE_KEY, String(next)) } catch (_) {}
  }

  onMounted(() => {
    weekStart.value = readStoredWeekStart()
  })

  return { weekStart, setWeekStart }
}
