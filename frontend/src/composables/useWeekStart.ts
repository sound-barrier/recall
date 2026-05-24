import { ref, onMounted } from 'vue'
import type { WeekStart } from '../match-helpers'

export type { WeekStart }
export const WEEK_START_STORAGE_KEY = 'recall.weekStart'

// Persisted preference for the first day of the week — drives the
// Month → Week → Day grouping's "Week of <date>" labels. US default
// is Sunday, matching the OS-level locale convention; Settings exposes
// a Sun/Mon toggle for users who prefer ISO-8601 / European weeks.
//
// Reads/writes localStorage to survive across launches. Mirrors
// useTheme's shape so the wiring at the App.vue level is consistent.
export function readStoredWeekStart(): WeekStart {
  try {
    const stored = localStorage.getItem(WEEK_START_STORAGE_KEY)
    if (stored === 'sunday' || stored === 'monday') return stored
  } catch (_) {}
  return 'sunday'
}

export function useWeekStart() {
  const weekStart = ref<WeekStart>('sunday')

  function setWeekStart(next: WeekStart) {
    weekStart.value = next
    try { localStorage.setItem(WEEK_START_STORAGE_KEY, next) } catch (_) {}
  }

  onMounted(() => {
    weekStart.value = readStoredWeekStart()
  })

  return { weekStart, setWeekStart }
}
