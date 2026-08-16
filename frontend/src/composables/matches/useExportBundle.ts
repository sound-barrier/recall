import { ref } from 'vue'

import { ExportBundle, ExportMatchesCSV } from '@/api-client'

// Export flows for the Matches set — the bundle-export modal (selected match
// keys + include-hidden/unknown toggles → ExportBundle) and the flat CSV export
// (a ready-to-save sheet MatchesView assembles → ExportMatchesCSV). Both
// dispatch through api.ts to the Wails save dialog or a browser blob download.
// Extracted from App.vue (REVIEW.md Q13); the error surface is injected.
export interface ExportBundleDeps {
  onError: (raw: string) => void
}

// Who a share-mode bundle is about. The stable player id is minted
// server-side, so the player only names themselves.
interface ExportBundleShare {
  handle: string
  message: string
}

/**
 * One trip through the export modal. `share` is the whole difference between
 * a backup and a bundle a coach can open as a session, so it travels with
 * the rest of the knobs rather than as a fourth positional argument.
 */
export interface ExportBundleRequest {
  /** What the user typed as the destination name; '' falls back to the default. */
  filename: string
  includeHidden: boolean
  includeUnknown: boolean
  /** null for a plain export. */
  share: ExportBundleShare | null
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
      await ExportBundle({
        matchKeys: exportBundleSelectedKeys.value,
        includeHidden: request.includeHidden,
        includeUnknown: request.includeUnknown,
        // Browser mode saves under this name; in the desktop build the
        // native save dialog is the naming affordance and owns it.
        filename: request.filename,
        ...(request.share ? { share: request.share } : {}),
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
    closeExportBundle,
    onExportMatchesCSV,
    onExportBundleConfirm,
  }
}
