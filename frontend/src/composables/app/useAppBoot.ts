import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'

import { GetStartupError } from '@/api'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'

// App boot coordinator. On mount it fans out into each domain store's loaders
// (app version, the matches feed + ignored-screenshot list + last-parse stamp,
// the screenshot-source candidates) — each is fire-and-forget so one
// subsystem's failure doesn't block the others — and surfaces any captured
// Startup failure into the app store's startup-error gate. Owns that modal's
// focus trap. Lives in a composable rather than a store action so App.vue stays
// free of orchestration and there's no app↔matches store import cycle.
export function useAppBoot() {
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()
  const settingsStore = useSettingsStore()
  const { showStartupErrorModal } = storeToRefs(appStore)

  // Non-dismissible: Escape is a no-op — a Startup failure means the store
  // never initialised, so restart is the only recovery.
  useModalFocusTrap(showStartupErrorModal, {
    containerSelector: '.modal-box.startup-error',
    onClose: () => {},
  })

  onMounted(() => {
    matchesStore.restoreLastParsedAt()
    void appStore.loadVersion()
    matchesStore.load()
    void matchesStore.loadIgnored()
    void settingsStore.loadScreenshotCandidates()
    GetStartupError()
      .then(msg => { if (msg) appStore.setStartupError(msg) })
      .catch(() => {})
  })
}
