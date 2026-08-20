import { computed, type ComputedRef } from 'vue'

import { useCoachStore } from '@/stores/coach'

// The ONE gate every write asks before it runs. One lock lives behind it —
// an open coaching session, where the visible records are the PLAYER's
// loaned corpus and any match-keyed write would land in the COACH's own
// database as an orphan row. The server refuses the same writes with a 409;
// this gate is what keeps the buttons honest. (A second lock — the tour's
// read-only sample profile — used to live here too. The sample is a writable
// sandbox now: a player who stays after the tour meets the real app, and
// deleting the profile is the reset.)
//
// Consumers disable their affordance with `writesLocked` and explain it with
// `lockReason` (via :title / lockedTitle); every writer calls guardWrite()
// as its first line so a keyboard path or a forced click can't slip past a
// disabled button.

/**
 * Shown while a coaching session is open. The wording names the way out —
 * the e2e write-gate spec matches every locked affordance's title on it.
 */
export const SESSION_LOCK_REASON
  = 'A coaching session is open — end the session to change your own matches.'

export interface WriteGate {
  /** True while the lock applies: disable the affordance. */
  writesLocked: ComputedRef<boolean>
  /** True only for the coaching session — the surfaces that must go quiet rather than merely read-only. */
  sessionActive: ComputedRef<boolean>
  /** Why writes are locked, or '' when they are not. */
  lockReason: ComputedRef<string>
  /** The reason while locked, the affordance's own title otherwise. */
  lockedTitle: (title: string) => string
  /** True when the write may proceed. Call it as `if (!guardWrite()) return`. */
  guardWrite: () => boolean
}

export function useWriteGate(): WriteGate {
  const coach = useCoachStore()

  const sessionActive = computed(() => coach.sessionActive)
  const writesLocked = sessionActive
  const lockReason = computed(() => (sessionActive.value ? SESSION_LOCK_REASON : ''))

  return {
    writesLocked,
    sessionActive,
    lockReason,
    lockedTitle: (title: string) => (writesLocked.value ? lockReason.value : title),
    guardWrite: () => !writesLocked.value,
  }
}
