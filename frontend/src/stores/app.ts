import { computed, nextTick, ref } from 'vue'
import { defineStore } from 'pinia'

import { StartSelfUpdate, RestartToApply, EventsOn } from '@/api-client'
import { plainLanguageError } from '@/error-helpers'
import {
  runUpdateCheck, useDataLocationQuery, useUpdateCheckQuery, useVersionQuery,
} from '@/queries/system'
import {
  SelfUpdateEvents,
  type SelfUpdateProgress, type SelfUpdateError, type SelfUpdateState,
} from '@/self-update-events'
import type { ViewId } from '@/composables/shared/keyboard/useTabKeyboardNav'
import { useParseStore } from '@/stores/parse'

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
  // Which top-level view is shown. Six of them are tabs; 'coach' — the
  // film room — is reached from the loan slip, the back affordance, or
  // `g f`, and deliberately has no tab. goToView switches it AND moves
  // focus into the newly-visible panel (each <section> has tabindex="-1")
  // so keyboard users land in the new content, not on the nav button.
  const view = ref<ViewId>('matches')
  async function goToView(next: string) {
    view.value = next as ViewId
    // Entering Parse: re-read the pending-screenshot count so "Run Parse · N"
    // reflects the folder now, not the initial-load batch. Fire-and-forget.
    if (next === 'ingest') void useParseStore().refreshNewCount()
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
  // the dialog renders version/license/links plus the result. Server state
  // lives in the query cache; the store exposes same-named computeds so
  // consumers (storeToRefs) are untouched.
  const versionQuery = useVersionQuery()
  const appVersion = computed(() => versionQuery.data.value ?? '')

  // The update-check query is permanently disabled (user-pulled ONLY, so
  // metered/locked-down setups don't pay for a lookup they didn't ask for);
  // runUpdateCheck() is the single trigger and isFetching is the busy gate.
  const updateQuery = useUpdateCheckQuery()
  const updateInfo = computed(() => updateQuery.data.value ?? null)
  const updateCheckBusy = computed(() => updateQuery.isFetching.value)
  const aboutOpen = ref(false)

  // Open the About dialog and run the release check (Chrome's "About" auto-
  // checks on open). The dialog is the single entry point now that the
  // standalone masthead button is gone.
  function openAbout() {
    aboutOpen.value = true
    void runUpdateCheck()
  }
  function closeAbout() { aboutOpen.value = false }

  // GitHub release check — kept as a store action name for the About
  // dialog's re-check button; in-flight dedup and the checked:false /
  // failure semantics live in the query layer.
  const checkForUpdates = runUpdateCheck

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
  // Fetched once by the query at store setup (an error reads as null —
  // Settings hides the path grid).
  const dataLocationQuery = useDataLocationQuery()
  const dataLocation = computed(() => dataLocationQuery.data.value ?? null)

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
    openAbout,
    closeAbout,
    checkForUpdates,
    selfUpdate,
    startSelfUpdate,
    restartToApply,
    dataLocation,
    startupError,
    showStartupErrorModal,
    setStartupError,
  }
})
