import { nextTick } from 'vue'
import { defineStore } from 'pinia'

import {
  PickTesseractBinary,
  ResetTesseractPath,
  ProbeTesseractBinary,
  SetTesseractPath,
  SetWatchEnabled,
  PickScreenshotsDir,
  GetScreenshotsFolderCandidates,
  SetScreenshotsDir,
  RevealScreenshotsDir,
  ResetScreenshotsDir,
} from '@/api'
import { useTesseractStatus } from '@/composables/settings/useTesseractStatus'
import { useFeatureToggle } from '@/composables/shared/useFeatureToggle'
import { useScreenshotsDir } from '@/composables/settings/useScreenshotsDir'
import { useTheme } from '@/composables/settings/useTheme'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

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
      // prior App.vue behaviour exactly.
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
    refreshNewCount: () => useMatchesStore().refreshNewCount(),
    shouldConfirmPickWhile: () => watchEnabled.value,
    onError: (m) => { appStore.setErrorFromRaw(m) },
  })

  // ── Appearance ────────────────────────────────────────────────────
  const { themeMode, setTheme } = useTheme()

  return {
    themeMode,
    setTheme,
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
    toggleWatch,
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
  }
})
