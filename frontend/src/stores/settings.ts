import { computed, nextTick, watchEffect, type Ref } from 'vue'
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
} from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import {
  useAutoBackupQuery, useCandidatesQuery, useExitOnCloseQuery,
  useScreenshotsDirQuery, useTesseractQuery, useWatchEnabledQuery,
} from '@/queries/settings'
import { useTesseractStatus } from '@/composables/settings/useTesseractStatus'
import { useFeatureToggle } from '@/composables/shared/useFeatureToggle'
import { useScreenshotsDir } from '@/composables/settings/useScreenshotsDir'
import { useTheme } from '@/composables/settings/useTheme'
import { useWeekStart } from '@/composables/shared/useWeekStart'
import { useAppStore } from '@/stores/app'
import { useParseStore } from '@/stores/parse'

// Settings domain: the OCR-engine (Tesseract) configuration + status. Migrated
// out of App.vue's <script setup>; the composable's deps are wired to the
// other stores (errors → app store, the Engine deep-link → app-store view).
// Folders/watch + clear-DB/backup move in here in later commits. Exposed flat
// (the composable's refs become store state) — no markRaw needed since
// consumers read the individual names, not the bundle.
export const useSettingsStore = defineStore('settings', () => {
  const appStore = useAppStore()

  // "Browse for binary…" + "Reset to default" pickers + the System Alert
  // CTA that deep-links into Settings → Engine.
  const {
    tesseractStatus,
    tesseractReady,
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
    onError: (m) => { appStore.setErrorFromRaw(m) },
  })

  // ── Screenshots directory ─────────────────────────────────────────
  // Persisted Go-side, mirrored here for rendering; also owns the
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
    refreshNewCount: () => useParseStore().refreshNewCount(),
    shouldConfirmPickWhile: () => watchEnabled.value,
    onError: (m) => { appStore.setErrorFromRaw(m) },
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
      await useParseStore().refreshNewCount()
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
    }
  }

  // ── Appearance ────────────────────────────────────────────────────
  const { themeMode, setTheme } = useTheme()

  // ── Calendar — first day of week ──────────────────────────────────
  // Owned here (not a per-component useWeekStart) so App, SettingsView, and
  // the matches-store dossier all read ONE instance.
  const { weekStart, setWeekStart } = useWeekStart()

  // ── Server-state hydration ────────────────────────────────────────
  // The settings reads live in the query cache (one query per endpoint —
  // per-subsystem isolation falls out of that: one failed call never
  // blocks the others). hydrate() pushes arrivals into the composable
  // state machines above, which keep their commit/rollback semantics for
  // writes. Replaces the old load() Promise.allSettled fan-out. The
  // tesseract queryFn never throws — a failed probe arrives as a real
  // found:false status (with the error string the Engine section renders).
  function hydrate<T>(data: Ref<T | undefined>, apply: (value: T) => void) {
    watchEffect(() => {
      const value = data.value
      if (value !== undefined) apply(value)
    })
  }
  hydrate(useScreenshotsDirQuery().data, dir => setScreenshotsDir(dir || ''))
  hydrate(useWatchEnabledQuery().data, on => setWatchEnabled(!!on))
  hydrate(useExitOnCloseQuery().data, exit => setExitOnClose(!!exit))
  hydrate(useTesseractQuery().data, setTesseractStatus)

  return {
    themeMode,
    setTheme,
    weekStart,
    setWeekStart,
    tesseractStatus,
    tesseractReady,
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
    setWatchEnabled,
    autoBackup,
    setAutoBackupInterval,
    toggleWatch,
    exitOnClose,
    setExitOnClose,
    toggleExitOnClose,
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
