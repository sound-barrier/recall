import { ref, nextTick } from 'vue'
import { defineStore } from 'pinia'

import type { NamedCandidate } from '@/api'
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
import { useWeekStart } from '@/composables/shared/useWeekStart'
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

  // ── Screenshots source picker (Windows auto-detect) ───────────────
  // The four canonical capture sources (Nvidia Overlay / OW PrntScn / Snip /
  // Steam), loaded once on the empty-state mount. pickDetectedSource commits an
  // auto-detected card's path; separate from pickDir (native dialog) so the
  // error path is tighter — the path came from our own probe.
  const screenshotCandidates = ref<NamedCandidate[]>([])
  async function loadScreenshotCandidates() {
    try {
      screenshotCandidates.value = await GetScreenshotsFolderCandidates()
    } catch (_) {
      // Best-effort hint for the empty-state + first-run pickers — on failure
      // (server mode / probe error) fall back to an empty list so the manual
      // "Choose folder…" path still shows; nothing here is user-blocking.
      screenshotCandidates.value = []
    }
  }
  async function pickDetectedSource(path: string) {
    try {
      await SetScreenshotsDir(path)
      setScreenshotsDir(path)
      await useMatchesStore().refreshNewCount()
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
    screenshotCandidates,
    loadScreenshotCandidates,
    pickDetectedSource,
  }
})
