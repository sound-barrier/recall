import { onScopeDispose, ref } from 'vue'

import { SWAP_HOLD_MS } from '@/composables/shared/useSwapHold'

// Two-click destructive confirm, shared by the Unknown tab's Dismiss
// buttons (unmatched cards, failed rows, ambiguous cards). The first
// trigger arms the key for windowMs and auto-disarms; a second trigger
// inside the window disarms and fires. Keyed, so concurrent arms on
// sibling cards don't collide; instances are independent, so two
// sections can never cross-arm each other's keys.
//
// ONE button both arms and fires, so the second press of a double-click
// would be the confirm. A freshly armed key is therefore held for
// SWAP_HOLD_MS — the useSwapHold rule, kept per key here — and a trigger
// while held is refused.
//
// The key is what the confirm is ABOUT, so callers fold everything the
// fire would act on into it (armKey: the card's file set). A card whose
// files change under an armed confirm then reads as a different key —
// unarmed — instead of carrying the arm across to files nobody confirmed.
/**
 * How long a destructive confirm stays armed. Shared with the bulk bar so the
 * two-click rule is one decision rather than two that can drift.
 */
export const ARM_WINDOW_MS = 3000

/** The arm key for a confirm that acts on a set of files: the owner plus every file. */
export function armKey(owner: string, files: readonly string[]): string {
  return [owner, ...files].join('\u0000')
}

function withKey(set: Set<string>, key: string, on: boolean): Set<string> {
  const next = new Set(set)
  if (on) next.add(key)
  else next.delete(key)
  return next
}

export function useArmedAction(windowMs = ARM_WINDOW_MS) {
  const armed = ref<Set<string>>(new Set())
  const held = ref<Set<string>>(new Set())
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const holdTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // Unmounting mid-arm must not leave a timer poking a dead ref.
  onScopeDispose(() => {
    for (const t of timers.values()) clearTimeout(t)
    for (const t of holdTimers.values()) clearTimeout(t)
  })

  function release(key: string) {
    clearTimeout(holdTimers.get(key))
    holdTimers.delete(key)
    if (held.value.has(key)) held.value = withKey(held.value, key, false)
  }

  function disarm(key: string) {
    clearTimeout(timers.get(key))
    timers.delete(key)
    release(key)
    if (armed.value.has(key)) armed.value = withKey(armed.value, key, false)
  }

  function arm(key: string) {
    armed.value = withKey(armed.value, key, true)
    held.value = withKey(held.value, key, true)
    timers.set(key, setTimeout(() => { disarm(key) }, windowMs))
    holdTimers.set(key, setTimeout(() => { release(key) }, SWAP_HOLD_MS))
  }

  function trigger(key: string, fire: () => void) {
    if (!armed.value.has(key)) {
      arm(key)
      return
    }
    if (held.value.has(key)) return
    disarm(key)
    fire()
  }

  function isArmed(key: string): boolean {
    return armed.value.has(key)
  }

  /** True for the beat after arming, while a second press is refused. */
  function isHeld(key: string): boolean {
    return held.value.has(key)
  }

  return { trigger, isArmed, isHeld }
}
