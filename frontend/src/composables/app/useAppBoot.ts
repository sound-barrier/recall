import { ref, computed, onMounted } from 'vue'

import { GetStartupError } from '@/api'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'

// App boot coordinator. On mount it fans out into each domain store's loaders
// (app version, the matches feed + ignored-screenshot list, the screenshot-
// source candidates) — each is fire-and-forget so one subsystem's failure
// doesn't block the others — and surfaces any captured Startup failure in a
// non-dismissible modal. Owns that modal's open-state + focus trap. Lives in a
// composable rather than a store action so App.vue stays free of orchestration
// and there's no app↔matches store import cycle.
export function useAppBoot() {
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()
  const settingsStore = useSettingsStore()

  // The Wails wrapper records SQLite / profile-init failures instead of
  // log.Fatal-ing into a blank window; the modal is open iff a message landed.
  const startupErrorMessage = ref('')
  const showStartupErrorModal = computed(() => startupErrorMessage.value !== '')
  // Non-dismissible: Escape is a no-op — a Startup failure means the store never
  // initialised, so restart is the only recovery.
  useModalFocusTrap(showStartupErrorModal, {
    containerSelector: '.modal-box.startup-error',
    onClose: () => {},
  })

  onMounted(() => {
    // Restore the last-parse timestamp so Settings shows "Last run · …"
    // immediately on launch, not just after a fresh parse this session.
    try {
      const v = localStorage.getItem('recall.lastParsedAt')
      if (v) matchesStore.lastParsedAt = Number(v) || null
    } catch (_) { /* private-mode localStorage */ }

    void appStore.loadVersion()
    matchesStore.load()
    void matchesStore.loadIgnored()
    void settingsStore.loadScreenshotCandidates()
    GetStartupError()
      .then(msg => { if (msg) startupErrorMessage.value = msg })
      .catch(() => {})
  })

  return { showStartupErrorModal, startupErrorMessage }
}
