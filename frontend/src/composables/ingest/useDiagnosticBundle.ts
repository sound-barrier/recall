import { ref } from 'vue'

import { ExportDiagnosticBundle } from '@/api-client'
import { useAppStore } from '@/stores/app'

/**
 * The diagnostics archive the Unknown tab offers when a screenshot will not
 * parse — logs plus the offending files, written somewhere the user can attach
 * it to an issue.
 *
 * Not a query: it produces a file rather than reading state, and running it
 * twice is two archives, not one cached answer.
 */
export function useDiagnosticBundle() {
  const savedAs = ref('')
  const busy = ref(false)

  async function exportBundle(): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      savedAs.value = await ExportDiagnosticBundle()
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    } finally {
      busy.value = false
    }
  }

  return { savedAs, busy, exportBundle }
}
