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
  // Whether the dialog opens already in share mode. The bulk bar's "Export
  // bundle…" leaves the choice to the user; the Reviews tab's "Send matches
  // out" and the palette's share action have already made it, and asking
  // again is a checkbox the user has to find.
  const exportBundleShareIntent = ref(false)

  function onExportBundleRequest(matchKeys: string[], opts: { share?: boolean } = {}) {
    exportBundleSelectedKeys.value = matchKeys
    exportBundleShareIntent.value = opts.share === true
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
        ...(request.share ? { share: request.share } : {}),
      })
      // "" means the native save dialog was dismissed — nothing was written,
      // so there is nothing to report. Otherwise say where it went: this is
      // the one action whose whole point is producing a file for somebody
      // else, and it used to finish in complete silence.
      if (saved) deps.onSaved(request.share ? `Shared: ${saved}` : `Saved: ${saved}`)
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
    exportBundleShareIntent,
    onExportBundleRequest,
    closeExportBundle,
    onExportMatchesCSV,
    onExportBundleConfirm,
  }
}
