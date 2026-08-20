import { ref } from 'vue'

import { ExportBundle, ExportMatchesCSV } from '@/api-client'

// Export flows for the Matches set — the bundle-export modal (selected match
// keys + include-hidden/unknown toggles → ExportBundle) and the flat CSV export
// (a ready-to-save sheet MatchesView assembles → ExportMatchesCSV). Both
// dispatch through api.ts to the Wails save dialog or a browser blob download.
// Extracted from App.vue (REVIEW.md Q13); the error surface is injected.
export interface ExportBundleDeps {
  onError: (raw: string) => void
  /** Where a written file landed, for the receipt strip. */
  onSaved: (message: string) => void
}

/** One trip through the export modal. */
export interface ExportBundleRequest {
  /** What the user typed as the destination name; '' falls back to the default. */
  filename: string
  includeHidden: boolean
  includeUnknown: boolean
}

export function useExportBundle(deps: ExportBundleDeps) {
  const exportBundleOpen = ref(false)
  const exportBundleSelectedKeys = ref<string[]>([])
  function onExportBundleRequest(matchKeys: string[]) {
    exportBundleSelectedKeys.value = matchKeys
    exportBundleOpen.value = true
  }

  function closeExportBundle() { exportBundleOpen.value = false }

  // Flat CSV — MatchesView hands up the ready-to-save string; we just dispatch.
  async function onExportMatchesCSV(csv: string, defaultName: string) {
    try {
      await ExportMatchesCSV(csv, defaultName)
    } catch (e) {
      deps.onError(String(e))
    }
  }

  async function onExportBundleConfirm(request: ExportBundleRequest) {
    try {
      const saved = await ExportBundle({
        matchKeys: exportBundleSelectedKeys.value,
        includeHidden: request.includeHidden,
        includeUnknown: request.includeUnknown,
        // Browser mode saves under this name; in the desktop build the
        // native save dialog is the naming affordance and owns it.
        filename: request.filename,
      })
      // "" means the native save dialog was dismissed — nothing was written,
      // so there is nothing to report. Otherwise say where it went: this is
      // the one action whose whole point is producing a file for somebody
      // else, and it used to finish in complete silence.
      if (saved) deps.onSaved(`Saved: ${saved}`)
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
    closeExportBundle,
    onExportMatchesCSV,
    onExportBundleConfirm,
  }
}
