import { ref } from 'vue'
import { defineStore } from 'pinia'

import { CheckForUpdate, GetVersion, type UpdateInfo, type DataLocation } from '@/api'
import { plainLanguageError } from '@/error-helpers'

// App-shell cross-cutting state: the global error banner, the app version,
// the user-pulled GitHub update check, and the data-location used by
// Settings → Backup. Migrated out of App.vue's <script setup> so the shell
// stops owning + prop-drilling it. View/nav and the UI-overlay state move in
// later commits of the Pinia migration.
export const useAppStore = defineStore('app', () => {
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
  // Set by App's boot coordinator (load()'s allSettled fan-out).
  const dataLocation = ref<DataLocation | null>(null)

  return {
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
  }
})
