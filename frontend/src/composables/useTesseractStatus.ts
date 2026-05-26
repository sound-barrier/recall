import { ref, computed, type Ref } from 'vue'
import type { TesseractStatus } from '../api'

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
}

export interface TesseractStatusApi {
  pickTesseractBinary: () => Promise<TesseractStatus | null | undefined>
  resetTesseractPath: () => Promise<TesseractStatus | null | undefined>
  onError?: (message: string) => void
  // Optional: jump the active view to Settings and scroll the
  // Engine section into view. Wired from the System Alert CTA.
  navigateToEngine?: () => Promise<void> | void
}

export function useTesseractStatus(api: TesseractStatusApi) {
  const tesseractStatus = ref<TesseractStatus>(EMPTY_TESSERACT_STATUS)
  const tesseractReady = computed(() => !!tesseractStatus.value?.found)
  const tesseractSupported = computed(
    () => tesseractReady.value && !!tesseractStatus.value?.supported,
  )
  const tesseractPickerBusy = ref(false)

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
    setTesseractStatus,
    pickTesseractBinary,
    resetTesseractPath,
    gotoEngineSettings,
  }
}
