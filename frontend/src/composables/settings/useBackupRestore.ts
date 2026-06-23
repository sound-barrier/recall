import { ref } from 'vue'

// Backup / restore flow for the database — JSON / CSV export plus
// JSON import (with a one-click confirm before destructive overwrite).
//
// Extracted from App.vue so the inline result chip ("Saved: …" /
// "Import failed: …") lifecycle (5-second auto-clear, captured by
// reference so a later flash doesn't get clobbered) lives in one
// place. The IngestView consumes the returned refs as props and
// emits handlers that wire back to these methods.
//
// `exporting` is a string discriminator ('json' | 'csv') so the UI
// can show "Saving…" on the specific button the user clicked while
// the other stays selectable. `false` = idle.

export type ExportStatus = { ok: boolean; message: string }

export interface BackupRestoreApi {
  // Triggers a save-as dialog (Wails) or browser download (server).
  exportJSON: () => Promise<string>
  exportCSV: () => Promise<string>
  // Triggers an open dialog (Wails) or file picker (server).
  importJSON: () => Promise<string>
  // Called after a successful import so the parent can reload state.
  afterImport: () => Promise<void> | void
}

const AUTO_CLEAR_MS = 5000

export function useBackupRestore(api: BackupRestoreApi) {
  const exporting = ref<false | 'json' | 'csv'>(false)
  const importing = ref(false)
  const importArmed = ref(false)
  const exportStatus = ref<ExportStatus | null>(null)

  // Capture the chip by reference and auto-clear after AUTO_CLEAR_MS
  // ONLY if no newer chip has replaced it. Prevents a fast double-
  // export from clobbering the second result's "Saved: …" message
  // when the first one's timer expires.
  function scheduleAutoClear() {
    if (!exportStatus.value) return
    const captured = exportStatus.value
    setTimeout(() => {
      if (exportStatus.value === captured) exportStatus.value = null
    }, AUTO_CLEAR_MS)
  }

  async function exportData(format: 'json' | 'csv') {
    if (exporting.value) return
    exporting.value = format
    exportStatus.value = null
    try {
      const path = format === 'csv' ? await api.exportCSV() : await api.exportJSON()
      if (path) {
        exportStatus.value = { ok: true, message: `Saved: ${path}` }
      }
      // Empty path = user cancelled; stay silent.
    } catch (e) {
      exportStatus.value = { ok: false, message: `Export failed: ${String(e)}` }
    } finally {
      exporting.value = false
      scheduleAutoClear()
    }
  }

  function exportDataJSON() { return exportData('json') }
  function exportDataCSV()  { return exportData('csv') }

  function armImport() {
    importArmed.value = true
    exportStatus.value = null
  }

  function cancelImport() {
    importArmed.value = false
  }

  async function importData() {
    if (importing.value) return
    importing.value = true
    importArmed.value = false
    try {
      const path = await api.importJSON()
      if (path) {
        exportStatus.value = { ok: true, message: `Imported: ${path}` }
        await api.afterImport()
      }
    } catch (e) {
      exportStatus.value = { ok: false, message: `Import failed: ${String(e)}` }
    } finally {
      importing.value = false
      scheduleAutoClear()
    }
  }

  return {
    exporting,
    importing,
    importArmed,
    exportStatus,
    exportData: exportDataJSON,
    exportDataCSV,
    armImport,
    cancelImport,
    importData,
  }
}
