import { onScopeDispose, ref } from 'vue'

// Two-click destructive confirm, shared by the Unknown tab's Dismiss
// buttons (unmatched cards, failed rows, ambiguous cards). The first
// trigger arms the key for windowMs and auto-disarms; a second trigger
// inside the window disarms and fires. Keyed, so concurrent arms on
// sibling cards don't collide; instances are independent, so two
// sections can never cross-arm each other's keys.
/**
 * How long a destructive confirm stays armed. Shared with the bulk bar so the
 * two-click rule is one decision rather than two that can drift.
 */
export const ARM_WINDOW_MS = 3000

export function useArmedAction(windowMs = ARM_WINDOW_MS) {
  const armed = ref<Set<string>>(new Set())
  const timers: Record<string, ReturnType<typeof setTimeout>> = {}

  // Unmounting mid-arm must not leave a timer poking a dead ref.
  onScopeDispose(() => {
    for (const t of Object.values(timers)) clearTimeout(t)
  })

  function disarm(key: string) {
    const t = timers[key]
    if (t !== undefined) {
      clearTimeout(t)
      delete timers[key]
    }
    if (armed.value.has(key)) {
      const next = new Set(armed.value)
      next.delete(key)
      armed.value = next
    }
  }

  function trigger(key: string, fire: () => void) {
    if (!armed.value.has(key)) {
      const next = new Set(armed.value)
      next.add(key)
      armed.value = next
      timers[key] = setTimeout(() => disarm(key), windowMs)
      return
    }
    disarm(key)
    fire()
  }

  function isArmed(key: string): boolean {
    return armed.value.has(key)
  }

  return { trigger, isArmed }
}
