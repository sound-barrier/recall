import { computed } from 'vue'

import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useFirstRunAcknowledged } from '@/composables/onboarding/useFirstRunAcknowledged'
import { cacheActiveProfile } from '@/composables/profile/profileStorage'

// First-run "name your main account" gate. Self-persists the dismissal in
// localStorage so the modal never returns once acknowledged, and is gated on
// the onboarding tour (the tour wins the first paint; the modal surfaces once
// the tour is finished/skipped). Step 2 commits a detected or custom-picked
// screenshots source via the same writers SettingsView uses, then acks the gate.
export function useFirstRun() {
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()
  const settingsStore = useSettingsStore()
  const { pending, ack } = useFirstRunAcknowledged()

  const firstRunModalOpen = computed(() => pending.value && !matchesStore.tourActive)

  function onFirstRunDismiss(renamedTo: string | null) {
    ack()
    // The first-run gate renames the ACTIVE profile — move the
    // profile-scoped localStorage scope with it before the reload.
    if (renamedTo !== null) cacheActiveProfile(renamedTo)
    // A rename tore down + re-init'd the SQLite store at the new directory
    // (same as the masthead chip's switch/create/rename). Reload so every
    // composable re-fetches against the renamed profile — profile state is
    // owned by the chip, not here.
    if (renamedTo !== null) window.location.reload()
  }

  async function onFirstRunPickSource(path: string) {
    await settingsStore.pickDetectedSource(path)
  }

  // Dismisses the way the modal's own buttons do, rename included — the
  // modal cannot, since it does not know whether the native dialog was
  // cancelled.
  async function onFirstRunPickCustomSource(renamedTo: string | null) {
    try {
      await settingsStore.pickDir()
      if (settingsStore.screenshotsDir) onFirstRunDismiss(renamedTo)
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
    }
  }

  return { firstRunModalOpen, onFirstRunDismiss, onFirstRunPickSource, onFirstRunPickCustomSource }
}
