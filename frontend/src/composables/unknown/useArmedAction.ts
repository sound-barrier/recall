import { ref } from 'vue'

// Two-click destructive confirm — the DashboardEditBanner Reset pattern,
// shared by the Unknown tab's Dismiss buttons (unmatched cards, failed
// rows, ambiguous cards). The first trigger arms the key for windowMs
// and auto-disarms; a second trigger inside the window disarms and
// fires. Keyed, so concurrent arms on sibling cards don't collide.
export function useArmedAction(windowMs = 3000) {
  const armed = ref<Set<string>>(new Set())
  const timers: Record<string, ReturnType<typeof setTimeout>> = {}

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
