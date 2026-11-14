import { computed, nextTick } from 'vue'
import { defineStore } from 'pinia'

import {
  SetAutoBackupInterval,
  PickTesseractBinary,
  ResetTesseractPath,
  ProbeTesseractBinary,
  SetTesseractPath,
  SetWatchEnabled,
  SetExitOnClose,
  PickScreenshotsDir,
  GetScreenshotsFolderCandidates,
  SetScreenshotsDir,
  RevealScreenshotsDir,
  ResetScreenshotsDir,
  ResetWindowSize,
  type WatcherStatus,
} from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import { refetchPendingCount } from '@/queries/matches'
import {
  settingRef, useAutoBackupQuery, useCandidatesQuery, useExitOnCloseQuery,
  useScreenshotsDirQuery, useTesseractQuery, useWatcherQuery, writeSetting,
} from '@/queries/settings'
import { EMPTY_TESSERACT_STATUS, useTesseractStatus } from '@/composables/settings/useTesseractStatus'
import { useFeatureToggle } from '@/composables/shared/useFeatureToggle'
import { useScreenshotsDir } from '@/composables/settings/useScreenshotsDir'
import { useTheme } from '@/composables/settings/useTheme'
import { useSessionBanner } from '@/composables/shared/useSessionBanner'
import { useWeekStart } from '@/composables/shared/useWeekStart'
import { useAppStore } from '@/stores/app'

// Settings domain: the OCR-engine (Tesseract) configuration + status. Migrated
// out of App.vue's <script setup>; the composable's deps are wired to the
// other stores (errors → app store, the Engine deep-link → app-store view).
// Folders/watch + clear-DB/backup move in here in later commits. Exposed flat
// (the composable's refs become store state) — no markRaw needed since
// consumers read the individual names, not the bundle.
export const useSettingsStore = defineStore('settings', () => {
  const appStore = useAppStore()

  // ── Server state ──────────────────────────────────────────────────
  // The settings reads live in the query cache (one query per endpoint —
  // per-subsystem isolation falls out of that: one failed call never blocks
  // the others), and the cache IS the state below: the composables read and
  // write these refs, which read the query and write through writeSetting.
  // The store used to copy each read into a ref of its own, so a write only
  // ever reached the copy — and a read answering late overwrote it.
  const watcherQuery = useWatcherQuery()
  const exitOnCloseQuery = useExitOnCloseQuery()
  const screenshotsDirQuery = useScreenshotsDirQuery()
  const tesseractQuery = useTesseractQuery()
  // The toggle's view of the watcher entry: its `enabled`. Turning Watch off
  // also says the watcher is off; turning it on leaves the state to the
  // `watch-state` event that follows, since only the server knows whether
  // the folder is there to watch.
  const watchEnabledState = computed<boolean>({
    get: () => watcherQuery.data.value?.enabled ?? false,
    set: (enabled) => {
      const state = watcherQuery.data.value?.watch_state ?? 'off'
      writeSetting<WatcherStatus>(qk.settings.watch, { enabled, watch_state: enabled ? state : 'off' })
    },
  })
  /** What the watcher is doing — the masthead dot reads it. */
  const watchState = computed(() => watcherQuery.data.value?.watch_state)
  const exitOnCloseState = settingRef(qk.settings.exitOnClose, () => exitOnCloseQuery.data.value, false)
  const screenshotsDirState = settingRef(qk.settings.screenshotsDir, () => screenshotsDirQuery.data.value || undefined, '')
  const tesseractState = settingRef(qk.settings.tesseract, () => tesseractQuery.data.value, EMPTY_TESSERACT_STATUS)

  // "Browse for binary…" + "Reset to default" pickers + the System Alert
  // CTA that deep-links into Settings → Engine.
  const {
    tesseractStatus,
    tesseractReady,
    tesseractChecking,
    tesseractSupported,
    tesseractPickerBusy,
    tesseractProbing,
    tesseractProbeMessage,
    tesseractProbeStatus,
    tesseractProbeTried,
    setTesseractStatus,
    pickTesseractBinary,
    resetTesseractPath,
    detectTesseractBinary,
    gotoEngineSettings,
  } = useTesseractStatus({
    pickTesseractBinary: PickTesseractBinary,
    resetTesseractPath: ResetTesseractPath,
    probeTesseractBinary: ProbeTesseractBinary,
    setTesseractPath: SetTesseractPath,
    onError: (m) => { appStore.setErrorFromRaw(m) },
    state: tesseractState,
    navigateToEngine: async () => {
      // Set the tab directly (not goToView, which would also move focus into
      // the panel) then scroll the Engine section into view — matches the
      // prior App.vue behavior exactly.
      appStore.view = 'settings'
      await nextTick()
      const el = document.getElementById('sec-engine')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  })

  // ── Folder watch ──────────────────────────────────────────────────
  // Calls the Go setter (owns the fsnotify watcher) + rolls back the UI on
  // round-trip failure. Gated on Tesseract being ready — turning it on with a
  // broken OCR setup would queue silent failures.
  const {
    enabled: watchEnabled,
    setEnabled: setWatchEnabled,
    toggle: toggleWatch,
  } = useFeatureToggle({
    set: SetWatchEnabled,
    state: watchEnabledState,
    canEnable: () => tesseractReady.value
      ? null
      : 'Configure Tesseract in Settings → Engine before enabling Watch.',
    onError: (m) => { appStore.setErrorFromRaw(m) },
  })

  // ── Automatic backups ─────────────────────────────────────────────
  // Schedule + newest-snapshot status live in the query cache; the setter
  // echoes the refreshed status into it so the row updates in one
  // round-trip. Round-trip failures surface on the app error banner and
  // leave the last-known status in place (the cache is untouched).
  const autoBackupQuery = useAutoBackupQuery()
  const autoBackup = computed(() => autoBackupQuery.data.value ?? null)
  async function setAutoBackupInterval(days: number) {
    try {
      getQueryClient().setQueryData(qk.settings.autoBackup, await SetAutoBackupInterval(days))
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
    }
  }

  // ── Window close behavior (desktop) ───────────────────────────────
  // false (default) hides the window to the tray so the folder watcher keeps
  // running; true quits Recall on close. Honored on Windows/Linux only — macOS
  // always stays in the menu bar (the SettingsWindow section hides on macOS).
  // No canEnable gate: either direction is always allowed.
  const {
    enabled: exitOnClose,
    setEnabled: setExitOnClose,
    toggle: toggleExitOnClose,
  } = useFeatureToggle({
    set: SetExitOnClose,
    state: exitOnCloseState,
    onError: (m) => { appStore.setErrorFromRaw(m) },
  })

  // ── Window size (desktop) ─────────────────────────────────────────
  // Nothing to mirror: the Go side owns the window and applies the default
  // immediately, so there is no state here that could drift from it. The
  // reset is only reachable in the desktop build — server mode has no window
  // — which SettingsWindow gates on.
  async function resetWindowSize() {
    try {
      await ResetWindowSize()
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
    }
  }

  // ── Screenshots directory ─────────────────────────────────────────
  // Persisted Go-side and read from its cache entry; also owns the
  // platform-probe state for SettingsView's "Detect Overwatch Folder".
  const {
    screenshotsDir,
    probing,
    probeMessage,
    probeStatus,
    probeTried,
    setScreenshotsDir,
    pickDir,
    detectDir,
    revealDir,
    resetDir,
  } = useScreenshotsDir({
    pickScreenshotsDir: PickScreenshotsDir,
    // The single-best ProbeScreenshotsDir endpoint was removed pre-1.0; the
    // candidates list is the strict superset, first exists:true = single best.
    probeScreenshotsDir: async () => {
      const candidates = await GetScreenshotsFolderCandidates()
      const tried = candidates.map(c => c.path).filter(Boolean)
      const hit = candidates.find(c => c.exists)
      return hit
        ? { found: true, path: hit.path, tried }
        : { found: false, tried }
    },
    setScreenshotsDir: SetScreenshotsDir,
    revealScreenshotsDir: RevealScreenshotsDir,
    resetScreenshotsDir: ResetScreenshotsDir,
    refreshNewCount: refetchPendingCount,
    shouldConfirmPickWhile: () => watchEnabled.value,
    onError: (m) => { appStore.setErrorFromRaw(m) },
    state: screenshotsDirState,
  })

  // ── Screenshots source picker (Windows auto-detect) ───────────────
  // The four canonical capture sources (Nvidia Overlay / OW PrntScn / Snip /
  // Steam), fetched once per session by the candidates query.
  // pickDetectedSource commits an auto-detected card's path; separate from
  // pickDir (native dialog) so the error path is tighter — the path came
  // from our own probe.
  const candidatesQuery = useCandidatesQuery()
  const screenshotCandidates = computed(() => candidatesQuery.data.value ?? [])
  async function pickDetectedSource(path: string) {
    try {
      await SetScreenshotsDir(path)
      setScreenshotsDir(path)
      await refetchPendingCount()
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
    }
  }

  // ── Appearance ────────────────────────────────────────────────────
  const { themeMode, setTheme } = useTheme()

  // ── Appearance — the live session banner ──────────────────────────
  // Off by default; see useSessionBanner for why a fifth session surface is
  // opt-in. Owned here so Settings writes it and App reads the same instance.
  const { sessionBanner, setSessionBanner } = useSessionBanner()

  // ── Calendar — first day of week ──────────────────────────────────
  // Owned here (not a per-component useWeekStart) so App, SettingsView, and
  // the matches-store dossier all read ONE instance.
  const { weekStart, setWeekStart } = useWeekStart()

  return {
    themeMode,
    setTheme,
    sessionBanner,
    setSessionBanner,
    weekStart,
    setWeekStart,
    tesseractStatus,
    tesseractReady,
    tesseractChecking,
    tesseractSupported,
    tesseractPickerBusy,
    tesseractProbing,
    tesseractProbeMessage,
    tesseractProbeStatus,
    tesseractProbeTried,
    setTesseractStatus,
    pickTesseractBinary,
    resetTesseractPath,
    detectTesseractBinary,
    gotoEngineSettings,
    watchEnabled,
    watchState,
    setWatchEnabled,
    autoBackup,
    setAutoBackupInterval,
    toggleWatch,
    exitOnClose,
    setExitOnClose,
    toggleExitOnClose,
    resetWindowSize,
    screenshotsDir,
    probing,
    probeMessage,
    probeStatus,
    probeTried,
    setScreenshotsDir,
    pickDir,
    detectDir,
    revealDir,
    resetDir,
    screenshotCandidates,
    pickDetectedSource,
  }
})
