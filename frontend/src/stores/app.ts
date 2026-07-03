import { computed, nextTick, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  CheckForUpdate, GetDataLocation, GetVersion, StartSelfUpdate, RestartToApply, EventsOn,
  type UpdateInfo, type DataLocation,
} from '@/api-client'
import { plainLanguageError } from '@/error-helpers'
import {
  SelfUpdateEvents,
  type SelfUpdateProgress, type SelfUpdateError, type SelfUpdateState,
} from '@/self-update-events'
import type { TabId } from '@/composables/shared/useTabKeyboardNav'
import { useMatchesStore } from '@/stores/matches'

// The error banner's Retry handler. May be async (the matches store passes its
// async load()); the banner fires it and ignores the result.
type RetryHandler = () => void | Promise<void>

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
  // The retry handler may be async (e.g. the matches store's load()) — the
  // banner fires it and ignores the result, so void | Promise<void>.
  const errorRetry = ref<RetryHandler | null>(null)

  // The single error-setting seam. Raw Go errors (most paths) go through
  // setErrorFromRaw → plainLanguageError so first-time users see a CTA, not
  // a "stat /Users/x: permission denied" diagnostic; pre-canned app-level
  // strings use setError directly.
  function setError(message: string, retry: RetryHandler | null = null) {
    error.value = message
    errorRetry.value = retry
  }
  function setErrorFromRaw(raw: string, retry: RetryHandler | null = null) {
    setError(plainLanguageError(raw), retry)
  }
  function clearError() {
    error.value = ''
    errorRetry.value = null
  }

  // ── Version + About (the update hub) ──────────────────────────────
  // Modeled on Chrome/Firefox: the update check lives inside About, not as a
  // standalone affordance. `openAbout` opens the dialog and kicks the check;
  // the dialog renders version/license/links plus the result.
  const appVersion = ref('')
  const updateInfo = ref<UpdateInfo | null>(null)
  // Gates the About dialog's update section while the GitHub releases
  // roundtrip is in flight. The check is user-triggered (NOT on mount) so
  // metered/locked-down setups don't pay for a lookup they didn't ask for.
  const updateCheckBusy = ref(false)
  const aboutOpen = ref(false)

  async function loadVersion() {
    try { appVersion.value = await GetVersion() } catch (_) { /* leave blank */ }
  }

  // Open the About dialog and run the release check (Chrome's "About" auto-
  // checks on open). The dialog is the single entry point now that the
  // standalone masthead button is gone.
  function openAbout() {
    aboutOpen.value = true
    void checkForUpdates()
  }
  function closeAbout() { aboutOpen.value = false }

  // GitHub release check. Idempotent — re-runs in flight are no-ops; re-runs
  // after a result silently replace updateInfo. Does NOT open the dialog
  // itself (openAbout owns that), so the About dialog can offer a re-check.
  async function checkForUpdates() {
    if (updateCheckBusy.value) return
    updateCheckBusy.value = true
    try {
      const u = await CheckForUpdate()
      if (u.checked) updateInfo.value = u
    } catch (_) {
      // Silent — the dialog shows the cached result or a network-failure
      // message via its !info branch.
    } finally {
      updateCheckBusy.value = false
    }
  }

  // ── In-app self-update ────────────────────────────────────────────
  // Drives the About dialog's Install / progress / Restart affordance,
  // shown only when updateInfo.can_self_update is true. The lifecycle is
  // event-driven: StartSelfUpdate kicks off a background pass in Go, and
  // the framework's wails:updater:* events (bridged through EventsOn)
  // move the phase. State lives here (not in the modal) so a background
  // download keeps its progress across About close/reopen.
  const selfUpdate = ref<SelfUpdateState>({ phase: 'idle', pct: null, error: '' })

  // Register the updater event handlers once. EventsOn has replace
  // semantics per name, so a repeat call is harmless; wiring lazily on
  // first user action keeps the no-network-on-mount contract (no
  // EventSource opens until the user clicks Install).
  let selfUpdateWired = false
  function wireSelfUpdateEvents() {
    if (selfUpdateWired) return
    selfUpdateWired = true
    EventsOn(SelfUpdateEvents.CheckStarted, () => { selfUpdate.value = { phase: 'starting', pct: null, error: '' } })
    EventsOn(SelfUpdateEvents.DownloadStarted, () => { selfUpdate.value = { phase: 'downloading', pct: null, error: '' } })
    EventsOn<SelfUpdateProgress>(SelfUpdateEvents.DownloadProgress, (p) => {
      const pct = p && p.total > 0 ? Math.round((p.written / p.total) * 100) : null
      selfUpdate.value = { phase: 'downloading', pct, error: '' }
    })
    EventsOn(SelfUpdateEvents.DownloadComplete, () => { selfUpdate.value = { phase: 'verifying', pct: 100, error: '' } })
    EventsOn(SelfUpdateEvents.Verifying, () => { selfUpdate.value = { phase: 'verifying', pct: 100, error: '' } })
    EventsOn(SelfUpdateEvents.Installing, () => { selfUpdate.value = { phase: 'installing', pct: 100, error: '' } })
    EventsOn(SelfUpdateEvents.UpdateReady, () => { selfUpdate.value = { phase: 'ready', pct: 100, error: '' } })
    EventsOn(SelfUpdateEvents.NoUpdate, () => { selfUpdate.value = { phase: 'idle', pct: null, error: '' } })
    EventsOn<SelfUpdateError>(SelfUpdateEvents.Error, (e) => {
      selfUpdate.value = { phase: 'error', pct: null, error: e?.message || 'Update failed. Please try again.' }
    })
  }

  // Kick off a check+download+install. Enters 'starting' immediately;
  // the wails:updater:* events carry it the rest of the way. A rejected
  // POST (409 self-update-unavailable) lands in the error phase.
  async function startSelfUpdate() {
    wireSelfUpdateEvents()
    selfUpdate.value = { phase: 'starting', pct: null, error: '' }
    try {
      await StartSelfUpdate()
    } catch (e) {
      selfUpdate.value = { phase: 'error', pct: null, error: plainLanguageError(String(e)) }
    }
  }

  // Apply a staged update: swap the binary and relaunch. On success the
  // process exits, so this only returns on failure.
  async function restartToApply() {
    selfUpdate.value = { ...selfUpdate.value, phase: 'restarting' }
    try {
      await RestartToApply()
    } catch (e) {
      selfUpdate.value = { phase: 'error', pct: null, error: plainLanguageError(String(e)) }
    }
  }

  // ── Data location (Settings → Backup) ─────────────────────────────
  // Hydrated by useAppBoot's fan-out at mount.
  const dataLocation = ref<DataLocation | null>(null)
  async function loadDataLocation() {
    try {
      dataLocation.value = await GetDataLocation()
    } catch (_) {
      dataLocation.value = null
    }
  }

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
    aboutOpen,
    loadVersion,
    openAbout,
    closeAbout,
    checkForUpdates,
    selfUpdate,
    startSelfUpdate,
    restartToApply,
    dataLocation,
    loadDataLocation,
    startupError,
    showStartupErrorModal,
    setStartupError,
  }
})
