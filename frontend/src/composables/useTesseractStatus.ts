import { ref, computed, type Ref } from 'vue'
import type { TesseractStatus, ProbeResult } from '../api'

// Tesseract OCR engine status — the current path / version /
// supported flag plus pickers for "Browse for the binary…" and
// "Reset to platform default". The composable also exposes the
// two derived booleans (`tesseractReady` + `tesseractSupported`)
// that the System Alert banner and the Parse-button gate read.
//
// Extracted from App.vue so the picker side effects (round-trip,
// busy-flag, error-banner forwarding) can be tested without
// mounting the full app.

export const EMPTY_TESSERACT_STATUS: TesseractStatus = {
  path: '',
  found: false,
  version: '',
  supported: false,
  error: '',
  default: '',
  // Empty platform short-circuits the per-OS branch in
  // SettingsEngine.vue's description copy until the first round-
  // trip lands, so we never render stale OS-specific guidance
  // during the boot window.
  platform: '',
}

export interface TesseractStatusApi {
  pickTesseractBinary: () => Promise<TesseractStatus | null | undefined>
  resetTesseractPath: () => Promise<TesseractStatus | null | undefined>
  // Detect: walk per-OS install locations + PATH; on a hit, apply the
  // discovered path via setTesseractPath; on a miss, surface the
  // tried list via probeMessage/probeTried. Optional so older mounts
  // can opt out.
  probeTesseractBinary?: () => Promise<ProbeResult>
  setTesseractPath?: (path: string) => Promise<TesseractStatus | null | undefined>
  onError?: (message: string) => void
  // Optional: jump the active view to Settings and scroll the
  // Engine section into view. Wired from the System Alert CTA.
  navigateToEngine?: () => Promise<void> | void
}

export type ProbeStatus = '' | 'success' | 'blocked'

export function useTesseractStatus(api: TesseractStatusApi) {
  const tesseractStatus = ref<TesseractStatus>(EMPTY_TESSERACT_STATUS)
  const tesseractReady = computed(() => !!tesseractStatus.value?.found)
  const tesseractSupported = computed(
    () => tesseractReady.value && !!tesseractStatus.value?.supported,
  )
  const tesseractPickerBusy = ref(false)
  // Mirror of screenshots-dir probe state so SettingsEngine's chip
  // can render the same success / blocked / Looked-in disclosure.
  const tesseractProbing      = ref(false)
  const tesseractProbeMessage = ref('')
  const tesseractProbeStatus  = ref<ProbeStatus>('')
  const tesseractProbeTried   = ref<string[]>([])

  async function pickTesseractBinary() {
    if (tesseractPickerBusy.value) return
    tesseractPickerBusy.value = true
    try {
      const next = await api.pickTesseractBinary()
      if (next) tesseractStatus.value = next
    } catch (e) {
      api.onError?.(String(e))
    } finally {
      tesseractPickerBusy.value = false
    }
  }

  async function resetTesseractPath() {
    try {
      const next = await api.resetTesseractPath()
      if (next) tesseractStatus.value = next
    } catch (e) {
      api.onError?.(String(e))
    }
  }

  async function detectTesseractBinary() {
    if (!api.probeTesseractBinary) return
    tesseractProbing.value = true
    tesseractProbeMessage.value = ''
    tesseractProbeStatus.value = ''
    tesseractProbeTried.value = []
    try {
      const res = await api.probeTesseractBinary()
      tesseractProbeTried.value = res.tried || []
      if (res.found && res.path && api.setTesseractPath) {
        const next = await api.setTesseractPath(res.path)
        if (next) tesseractStatus.value = next
        tesseractProbeStatus.value = 'success'
        tesseractProbeMessage.value = `Detected · ${res.path}`
      } else {
        tesseractProbeStatus.value = 'blocked'
        tesseractProbeMessage.value = 'No Tesseract install found in the usual places. Use Change Binary… to point at it.'
      }
    } catch (e) {
      tesseractProbeStatus.value = 'blocked'
      tesseractProbeMessage.value = `Detect failed: ${String(e)}`
    } finally {
      tesseractProbing.value = false
    }
  }

  function setTesseractStatus(next: TesseractStatus) {
    tesseractStatus.value = next
  }

  async function gotoEngineSettings() {
    await api.navigateToEngine?.()
  }

  return {
    tesseractStatus: tesseractStatus as Readonly<Ref<TesseractStatus>>,
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
}
