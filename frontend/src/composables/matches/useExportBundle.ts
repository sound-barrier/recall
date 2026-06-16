import { ref } from 'vue'

import { ExportBundle, ExportMatchesCSV } from '@/api'

// Export flows for the Matches set — the bundle-export modal (selected match
// keys + include-hidden/unknown toggles → ExportBundle) and the flat CSV export
// (a ready-to-save sheet MatchesView assembles → ExportMatchesCSV). Both
// dispatch through api.ts to the Wails save dialog or a browser blob download.
// Extracted from App.vue (REVIEW.md Q13); the error surface is injected.
export interface ExportBundleDeps {
  onError: (raw: string) => void
}

export function useExportBundle(deps: ExportBundleDeps) {
  const exportBundleOpen = ref(false)
  const exportBundleSelectedKeys = ref<string[]>([])

  function onExportBundleRequest(matchKeys: string[]) {
    exportBundleSelectedKeys.value = matchKeys
    exportBundleOpen.value = true
  }

  // Flat CSV — MatchesView hands up the ready-to-save string; we just dispatch.
  async function onExportMatchesCSV(csv: string, defaultName: string) {
    try {
      await ExportMatchesCSV(csv, defaultName)
    } catch (e) {
      deps.onError(String(e))
    }
  }

  async function onExportBundleConfirm(
    _filename: string,
    includeHidden: boolean,
    includeUnknown: boolean,
  ) {
    try {
      await ExportBundle({
        matchKeys: exportBundleSelectedKeys.value,
        includeHidden,
        includeUnknown,
      })
    } catch (e) {
      deps.onError(String(e))
    } finally {
      exportBundleOpen.value = false
      exportBundleSelectedKeys.value = []
    }
  }

  return {
    exportBundleOpen,
    exportBundleSelectedKeys,
    onExportBundleRequest,
    onExportMatchesCSV,
    onExportBundleConfirm,
  }
}
