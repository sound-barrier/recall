import { usePersistedRef, parseClampedNumber } from './usePersistedRef'

export const MIN_PLAY_PERCENT_STORAGE_KEY = 'recall.minPlayPercent'
export const MIN_PLAY_MINUTES_STORAGE_KEY = 'recall.minPlayMinutes'

// Persisted "minimum-play" threshold for the FilterRail. Two knobs in
// one composable because they're conceptually one filter — a match
// qualifies if a candidate hero meets EITHER threshold (OR semantics).
// Use case: "if I touched Lucio for 2% to cap a point, don't surface
// that in the Lucio history; require ≥ 5% or ≥ 1 minute of play."
// Both default to 0 = filter disabled.

const parsePercent = parseClampedNumber(0, 100)
// No hard upper bound on minutes — a user could conceivably set 60 to
// mean "only matches I played a full hour of one hero". 9999 acts as
// "no upper bound" without admitting Infinity.
const parseMinutes = parseClampedNumber(0, 9999)

export function readStoredMinPlayPercent(): number {
  try {
    return parsePercent(localStorage.getItem(MIN_PLAY_PERCENT_STORAGE_KEY) ?? '') ?? 0
  } catch (_) {
    return 0
  }
}

export function readStoredMinPlayMinutes(): number {
  try {
    return parseMinutes(localStorage.getItem(MIN_PLAY_MINUTES_STORAGE_KEY) ?? '') ?? 0
  } catch (_) {
    return 0
  }
}

export function useMinPlayThreshold() {
  const { value: minPlayPercent, set: setPercent } = usePersistedRef<number>({
    key: MIN_PLAY_PERCENT_STORAGE_KEY,
    defaultValue: 0,
    parse: parsePercent,
  })
  const { value: minPlayMinutes, set: setMinutes } = usePersistedRef<number>({
    key: MIN_PLAY_MINUTES_STORAGE_KEY,
    defaultValue: 0,
    parse: parseMinutes,
  })

  // Clamp on the write path too so the in-memory ref can't drift
  // out of range between mounts (the read path's parseClampedNumber
  // covers only the hydrate). NaN / non-finite inputs collapse to 0.
  function clamp(n: number, min: number, max: number): number {
    if (!Number.isFinite(n)) return 0
    return Math.max(min, Math.min(max, n))
  }

  function setMinPlayPercent(next: number) {
    setPercent(clamp(next, 0, 100))
  }

  function setMinPlayMinutes(next: number) {
    setMinutes(clamp(next, 0, 9999))
  }

  return { minPlayPercent, minPlayMinutes, setMinPlayPercent, setMinPlayMinutes }
}
