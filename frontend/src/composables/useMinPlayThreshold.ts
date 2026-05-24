import { ref, onMounted } from 'vue'

export const MIN_PLAY_PERCENT_STORAGE_KEY = 'recall.minPlayPercent'
export const MIN_PLAY_MINUTES_STORAGE_KEY = 'recall.minPlayMinutes'

// Persisted "minimum-play" threshold for the FilterRail. Two knobs in
// one composable because they're conceptually one filter — a match
// qualifies if a candidate hero meets EITHER threshold (OR semantics).
// Use cases the user gave: "if I touched Lucio for 2% to cap a point,
// don't surface that in the Lucio history; require at least 5% or 1
// minute of actual play." Both default to 0 = filter disabled.
//
// Storage shape matches useIncludeUndated / useWeekStart: plain string
// representation, parsed on read with bounds enforcement so a hand-
// edited localStorage entry can't crash the app.

function readNumberClamped(key: string, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return 0
    const n = Number(raw)
    if (!Number.isFinite(n)) return 0
    if (n < min) return min
    if (n > max) return max
    return n
  } catch (_) {
    return 0
  }
}

export function readStoredMinPlayPercent(): number {
  return readNumberClamped(MIN_PLAY_PERCENT_STORAGE_KEY, 0, 100)
}

export function readStoredMinPlayMinutes(): number {
  // No hard upper bound — a user could conceivably set 60 to mean
  // "only matches I played a full hour of one hero". 9999 is generous
  // enough to act as "no upper bound" without admitting Infinity.
  return readNumberClamped(MIN_PLAY_MINUTES_STORAGE_KEY, 0, 9999)
}

export function useMinPlayThreshold() {
  const minPlayPercent = ref(0)
  const minPlayMinutes = ref(0)

  function setMinPlayPercent(next: number) {
    const clamped = Math.max(0, Math.min(100, Number.isFinite(next) ? next : 0))
    minPlayPercent.value = clamped
    try { localStorage.setItem(MIN_PLAY_PERCENT_STORAGE_KEY, String(clamped)) } catch (_) {}
  }

  function setMinPlayMinutes(next: number) {
    const clamped = Math.max(0, Math.min(9999, Number.isFinite(next) ? next : 0))
    minPlayMinutes.value = clamped
    try { localStorage.setItem(MIN_PLAY_MINUTES_STORAGE_KEY, String(clamped)) } catch (_) {}
  }

  onMounted(() => {
    minPlayPercent.value = readStoredMinPlayPercent()
    minPlayMinutes.value = readStoredMinPlayMinutes()
  })

  return { minPlayPercent, minPlayMinutes, setMinPlayPercent, setMinPlayMinutes }
}
