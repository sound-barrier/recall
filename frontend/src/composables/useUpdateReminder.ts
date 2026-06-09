import { computed, type Ref } from 'vue'
import { usePersistedRef, parseClampedNumber } from './usePersistedRef'
import type { UpdateInfo } from '../api'

// 90-day threshold for the "haven't checked for updates in a while"
// banner. Roughly six OW seasons — quiet enough that a regularly-
// active user never sees the banner, sharp enough that an install
// that's been dark for a while is reminded that roster/format updates
// may exist. Constant in code (not a user setting) per the YAGNI
// rule in the root CLAUDE.md.
const UPDATE_REMINDER_DAYS = 90
const UPDATE_REMINDER_MS = UPDATE_REMINDER_DAYS * 24 * 60 * 60 * 1000

const DISMISSED_KEY = 'recall.updateReminder.dismissedAt'

// useUpdateReminder gates the visibility of the "haven't checked in
// 90 days" banner based on the install's persisted last-checked
// timestamp (from /api/v1/system/update's `last_checked_at` field)
// and the user's last in-session dismissal (localStorage).
//
// Banner shows when EITHER:
//   - last_checked_at has never been set (a brand-new install), OR
//   - last_checked_at is older than 90 days AND the user hasn't
//     dismissed within the current 90-day window.
//
// The dismissedAt persistence + the lastCheckedAt input together
// implement the per-cycle dismissal semantics: once a check completes
// (lastCheckedAt updates), the next 90 days reset the cycle and the
// stored dismissedAt is no longer "current".
export function useUpdateReminder(
  updateInfo: Ref<UpdateInfo | null>,
  now: () => number = Date.now,
): {
  shouldShowBanner: Readonly<Ref<boolean>>
  daysSinceLastCheck: Readonly<Ref<number | null>>
  dismiss: () => void
} {
  const { value: dismissedAt, set: setDismissed } = usePersistedRef<number>({
    key: DISMISSED_KEY,
    defaultValue: 0,
    parse: parseClampedNumber(0, Number.MAX_SAFE_INTEGER),
  })

  const lastCheckedMs = computed<number | null>(() => {
    const raw = updateInfo.value?.last_checked_at
    if (!raw) return null
    const ms = Date.parse(raw)
    return Number.isFinite(ms) ? ms : null
  })

  const daysSinceLastCheck = computed<number | null>(() => {
    const ms = lastCheckedMs.value
    if (ms === null) return null
    return Math.floor((now() - ms) / (24 * 60 * 60 * 1000))
  })

  const shouldShowBanner = computed<boolean>(() => {
    // updateInfo not loaded yet — keep banner hidden so we don't
    // flash false-positive content on first paint.
    if (!updateInfo.value) return false

    const ms = lastCheckedMs.value
    if (ms === null) {
      // Never checked → fresh install. Banner shows unless the user
      // has already dismissed THIS state at least once.
      return dismissedAt.value === 0
    }

    const ageMs = now() - ms
    if (ageMs < UPDATE_REMINDER_MS) return false
    // Past threshold; only show if the user hasn't dismissed in
    // this 90-day window (dismissedAt is newer than lastCheckedAt
    // → same window, already dismissed).
    return dismissedAt.value < ms
  })

  function dismiss() {
    setDismissed(now())
  }

  return { shouldShowBanner, daysSinceLastCheck, dismiss }
}

// Exposed for the e2e spec's localStorage seeding.
export const UPDATE_REMINDER_DISMISSED_KEY = DISMISSED_KEY
export const UPDATE_REMINDER_THRESHOLD_DAYS = UPDATE_REMINDER_DAYS
