import { ref, type Ref } from 'vue'

// Generic on/off feature toggle backed by a server round-trip.
//
// Used by both `watchEnabled` and `prometheusEnabled` in App.vue —
// each was an identical eight-line block (next = !ref, optional
// guard, call setter, on success commit the ref, on failure surface
// the error). This factory replaces both with one parameterised
// composable.
//
// `canEnable?` lets a caller short-circuit the "off → on" transition
// with an explanatory message (e.g. "Configure Tesseract before
// enabling Watch."). The "on → off" transition is never gated;
// turning a broken feature off is always allowed.

export interface FeatureToggleApi {
  // Persists the new state. Throws on failure; the toggle keeps the
  // previous local value.
  set: (next: boolean) => Promise<unknown>
  // Optional gate for the off → on transition. Returns an error
  // message string to block, or null/undefined to allow.
  canEnable?: () => string | null | undefined
  onError?: (message: string) => void
}

export function useFeatureToggle(api: FeatureToggleApi) {
  const enabled = ref(false)

  function setEnabled(next: boolean) {
    enabled.value = next
  }

  async function toggle() {
    const next = !enabled.value
    if (next) {
      const reason = api.canEnable?.()
      if (reason) {
        api.onError?.(reason)
        return
      }
    }
    try {
      await api.set(next)
      enabled.value = next
    } catch (e) {
      api.onError?.(String(e))
    }
  }

  return {
    enabled: enabled as Readonly<Ref<boolean>>,
    setEnabled,
    toggle,
  }
}
