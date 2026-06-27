import { ref } from 'vue'

// Backup / restore / import flows for the database:
//   - Backup        — save a complete native SQLite snapshot (.db).
//   - Restore       — REPLACE the live DB from a .db snapshot (two-step
//                     arm/confirm, since it wipes local data).
//   - Import matches — MERGE a shared bundle's matches (additive; existing
//                     keys skipped; no confirm needed — it can't destroy data).
//
// Extracted from App.vue so the inline result chip ("Saved: …" / "Restore
// failed: …" / "Imported N…") lifecycle (5-second auto-clear, captured by
// reference so a later flash doesn't get clobbered) lives in one place. The
// SettingsBackupRestore panel + the Matches-view import button consume the
// returned refs/handlers.

export type ExportStatus = { ok: boolean; message: string }

// MatchImportResult mirrors the api.ts return: empty path = user cancelled.
export interface MatchImportResult {
  path: string
  imported: number
  skipped: number
}

export interface BackupRestoreApi {
  // Save a native .db snapshot (Wails dialog / browser download). "" on cancel.
  backup: () => Promise<string>
  // Pick a .db snapshot and REPLACE the live DB. "" on cancel.
  restore: () => Promise<string>
  // Pick a bundle .zip and MERGE its matches. Empty path on cancel.
  importMatches: () => Promise<MatchImportResult>
  // Refresh records after a restore or merge so the UI reflects the new data.
  reload: () => Promise<void> | void
}

const AUTO_CLEAR_MS = 5000

export function useBackupRestore(api: BackupRestoreApi) {
  const backingUp = ref(false)
  const restoring = ref(false)
  const restoreArmed = ref(false)
  const importingMatches = ref(false)
  const status = ref<ExportStatus | null>(null)

  // Capture the chip by reference and auto-clear after AUTO_CLEAR_MS ONLY if no
  // newer chip has replaced it — prevents a fast second action from clobbering
  // the later result when the first one's timer expires.
  function scheduleAutoClear() {
    if (!status.value) return
    const captured = status.value
    setTimeout(() => {
      if (status.value === captured) status.value = null
    }, AUTO_CLEAR_MS)
  }

  const anyBusy = () => backingUp.value || restoring.value || importingMatches.value

  async function backup() {
    if (anyBusy()) return
    backingUp.value = true
    status.value = null
    try {
      const path = await api.backup()
      if (path) status.value = { ok: true, message: `Saved: ${path}` }
      // Empty path = user cancelled; stay silent.
    } catch (e) {
      status.value = { ok: false, message: `Backup failed: ${String(e)}` }
    } finally {
      backingUp.value = false
      scheduleAutoClear()
    }
  }

  function armRestore() {
    restoreArmed.value = true
    status.value = null
  }

  function cancelRestore() {
    restoreArmed.value = false
  }

  async function restore() {
    if (anyBusy()) return
    restoring.value = true
    restoreArmed.value = false
    try {
      const path = await api.restore()
      if (path) {
        status.value = { ok: true, message: `Restored from: ${path}` }
        await api.reload()
      }
    } catch (e) {
      status.value = { ok: false, message: `Restore failed: ${String(e)}` }
    } finally {
      restoring.value = false
      scheduleAutoClear()
    }
  }

  async function importMatches() {
    if (anyBusy()) return
    importingMatches.value = true
    status.value = null
    try {
      const result = await api.importMatches()
      if (result.path) {
        status.value = { ok: true, message: importMessage(result) }
        await api.reload()
      }
    } catch (e) {
      status.value = { ok: false, message: `Import failed: ${String(e)}` }
    } finally {
      importingMatches.value = false
      scheduleAutoClear()
    }
  }

  return {
    backingUp,
    restoring,
    restoreArmed,
    importingMatches,
    status,
    backup,
    armRestore,
    cancelRestore,
    restore,
    importMatches,
  }
}

// importMessage renders the merge outcome: how many matches were added and,
// when any collided, how many were skipped as already present.
function importMessage({ imported, skipped }: MatchImportResult): string {
  const added = `Imported ${imported} match${imported === 1 ? '' : 'es'}`
  if (skipped === 0) return added
  return `${added}, skipped ${skipped} already present`
}
