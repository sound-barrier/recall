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

/**
 * Shown on every "send to a coach" affordance while a session is open. A
 * separate sentence from SESSION_LOCK_REASON because sharing is not blocked
 * by the lock on WRITES — the matches on screen are someone else's, and
 * sending them on is the thing that must not happen. Four doors say it; they
 * say it from here.
 */
export const SESSION_SHARE_REASON
  = 'These matches are on loan — you can only send your own to a coach.'

/** The same sentence for a single row (the context menu). */
export const SESSION_SHARE_REASON_ONE
  = 'This match is on loan — you can only send your own to a coach.'

/**
 * Shown when the set to send is empty. An enabled "Send 0 to a coach…" opens
 * a dialog with nothing in it and a Send that cannot fire — a dead end where
 * a disabled button with a reason is the whole answer.
 */
export const NOTHING_TO_SEND_REASON
  = 'Nothing to send — narrow to some matches, or tick the ones you want.'

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
