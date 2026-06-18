import { nextTick } from 'vue'
import { defineStore } from 'pinia'

import {
  PickTesseractBinary,
  ResetTesseractPath,
  ProbeTesseractBinary,
  SetTesseractPath,
} from '@/api'
import { useTesseractStatus } from '@/composables/settings/useTesseractStatus'
import { useAppStore } from '@/stores/app'

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

  return {
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
  }
})
