import { computed, nextTick, ref } from 'vue'
import { defineStore } from 'pinia'

import { CheckForUpdate, GetVersion, type UpdateInfo, type DataLocation } from '@/api-client'
import { plainLanguageError } from '@/error-helpers'
import type { TabId } from '@/composables/shared/useTabKeyboardNav'
import { useMatchesStore } from '@/stores/matches'

// App-shell cross-cutting state: the global error banner, the app version,
// the user-pulled GitHub update check, and the data-location used by
// Settings → Backup. Migrated out of App.vue's <script setup> so the shell
// stops owning + prop-drilling it. View/nav and the UI-overlay state move in
// later commits of the Pinia migration.
export const useAppStore = defineStore('app', () => {
  // ── Nav ───────────────────────────────────────────────────────────
  // Which top-level tab is shown. goToView switches it AND moves focus into
  // the newly-visible panel (each <section> has tabindex="-1") so keyboard
  // users land in the new content, not on the nav button.
  const view = ref<TabId>('matches')
  async function goToView(next: string) {
    view.value = next as TabId
    // Entering Parse: re-read the pending-screenshot count so "Run Parse · N"
    // reflects the folder now, not the initial-load batch. Fire-and-forget.
    if (next === 'ingest') void useMatchesStore().refreshNewCount()
    await nextTick()
    const panel = document.getElementById(`panel-${next}`)
    if (panel) panel.focus({ preventScroll: true })
  }

  // ── Global error banner ───────────────────────────────────────────
  // `errorRetry` carries the function the banner's Retry button invokes
  // when the failed action is replayable (currently the initial load());
  // cleared whenever `error` is cleared or set from a non-retryable path.
  const error = ref('')
  const errorRetry = ref<(() => void) | null>(null)

  // The single error-setting seam. Raw Go errors (most paths) go through
  // setErrorFromRaw → plainLanguageError so first-time users see a CTA, not
  // a "stat /Users/x: permission denied" diagnostic; pre-canned app-level
  // strings use setError directly.
  function setError(message: string, retry: (() => void) | null = null) {
    error.value = message
    errorRetry.value = retry
  }
  function setErrorFromRaw(raw: string, retry: (() => void) | null = null) {
    setError(plainLanguageError(raw), retry)
  }
  function clearError() {
    error.value = ''
    errorRetry.value = null
  }

  // ── Version + user-pulled update check ────────────────────────────
  const appVersion = ref('')
  const updateInfo = ref<UpdateInfo | null>(null)
  // Gates the masthead "Check for updates" button while the GitHub
  // releases roundtrip is in flight. The check is user-triggered (NOT on
  // mount) so metered/locked-down setups don't pay for a lookup they
  // didn't ask for.
  const updateCheckBusy = ref(false)
  const updateCheckModalOpen = ref(false)

  async function loadVersion() {
    try { appVersion.value = await GetVersion() } catch (_) { /* leave blank */ }
  }

  // User-triggered release check. Idempotent — re-clicks in flight are
  // no-ops; re-clicks after a result silently replace updateInfo. Opens
  // the modal so the result is visible regardless of which branch lands.
  async function checkForUpdates() {
    updateCheckModalOpen.value = true
    if (updateCheckBusy.value) return
    updateCheckBusy.value = true
    try {
      const u = await CheckForUpdate()
      if (u.checked) updateInfo.value = u
    } catch (_) {
      // Silent — the modal shows the cached result or a network-failure
      // message via its !info branch.
    } finally {
      updateCheckBusy.value = false
    }
  }

  // ── Data location (Settings → Backup) ─────────────────────────────
  // Set by the boot coordinator (load()'s allSettled fan-out).
  const dataLocation = ref<DataLocation | null>(null)

  // ── Startup failure ───────────────────────────────────────────────
  // Filled by useAppBoot from GetStartupError(); the modal is open iff the
  // message is non-empty. Non-dismissible (restart is the only recovery), so
  // the only mutation is set-once on boot.
  const startupError = ref('')
  const showStartupErrorModal = computed(() => startupError.value !== '')
  function setStartupError(message: string) { startupError.value = message }

  return {
    view,
    goToView,
    error,
    errorRetry,
    setError,
    setErrorFromRaw,
    clearError,
    appVersion,
    updateInfo,
    updateCheckBusy,
    updateCheckModalOpen,
    loadVersion,
    checkForUpdates,
    dataLocation,
    startupError,
    showStartupErrorModal,
    setStartupError,
  }
})
