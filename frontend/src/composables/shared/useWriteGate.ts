import { computed, type ComputedRef } from 'vue'

import { useActiveProfile } from '@/composables/profile/useActiveProfile'
import { useCoachStore } from '@/stores/coach'

// The ONE gate every write asks before it runs. Two independent locks live
// behind it, and both mean the same thing to a writer — the server will
// answer 409, so the UI must not ask:
//
//   - the read-only sample profile (the tour's "test" profile), and
//   - an open coaching session, where the visible records are the PLAYER's
//     loaned corpus and any match-keyed write would land in the COACH's own
//     database as an orphan row.
//
// Consumers disable their affordance with `writesLocked` and explain it with
// `lockReason` (via :title / lockedTitle); every writer calls guardWrite()
// as its first line so a keyboard path or a forced click can't slip past a
// disabled button.

/** Shown while the active profile is the immutable sample. */
export const READ_ONLY_LOCK_REASON = 'This is a read-only sample profile.'

/**
 * Shown while a coaching session is open. The wording names the way out —
 * the e2e write-gate spec matches every locked affordance's title on it.
 */
export const SESSION_LOCK_REASON
  = 'A coaching session is open — end the session to change your own matches.'

export interface WriteGate {
  /** True while ANY lock applies: disable the affordance. */
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
  const { isReadOnly } = useActiveProfile()
  const coach = useCoachStore()

  const sessionActive = computed(() => coach.sessionActive)
  const writesLocked = computed(() => sessionActive.value || isReadOnly.value)
  // The session is named first: it is the lock the user can lift from here,
  // and a coach reviewing a bundle on the sample profile is a real case.
  const lockReason = computed(() => {
    if (sessionActive.value) return SESSION_LOCK_REASON
    if (isReadOnly.value) return READ_ONLY_LOCK_REASON
    return ''
  })

  return {
    writesLocked,
    sessionActive,
    lockReason,
    lockedTitle: (title: string) => (writesLocked.value ? lockReason.value : title),
    guardWrite: () => !writesLocked.value,
  }
}
