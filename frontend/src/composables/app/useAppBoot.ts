import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'

import { fetchStartupError } from '@/queries/system'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useNativeMenu } from '@/composables/app/useNativeMenu'

// App boot coordinator. On mount it fires the remaining store loaders (the
// matches feed + ignored-screenshot list + last-parse stamp — the version /
// settings / candidates reads hydrate from their queries at store setup) —
// each fire-and-forget so one subsystem's failure doesn't block the others —
// and surfaces any captured Startup failure into the app store's
// startup-error gate. Owns that modal's focus trap. Lives in a composable
// rather than a store action so App.vue stays free of orchestration and
// there's no app↔domain store import cycle.
export function useAppBoot() {
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()
  const { showStartupErrorModal } = storeToRefs(appStore)

  // Non-dismissible: Escape is a no-op — a Startup failure means the store
  // never initialised, so restart is the only recovery.
  useModalFocusTrap(showStartupErrorModal, {
    containerSelector: '.modal-box.startup-error',
    onClose: () => {},
  })

  // Native menu bar (macOS) → in-app dialogs. No-op on other platforms.
  useNativeMenu()

  onMounted(() => {
    matchesStore.restoreLastParsedAt()
    void matchesStore.load()
    void matchesStore.loadIgnored()
    fetchStartupError()
      .then(msg => { if (msg) appStore.setStartupError(msg) })
      .catch(() => {})
  })
}
