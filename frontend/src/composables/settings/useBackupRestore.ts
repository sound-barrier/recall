import { ref } from 'vue'

import type { CoachReturnSheet } from '@/api-client'
import { useWriteGate } from '@/composables/shared/useWriteGate'

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

// MatchImportResult mirrors the api.ts return: empty path = user canceled.
// `kind` is the server's sniff of the archive — one affordance accepts both
// a shared bundle and a coach's notes, and only the bundle arm merges
// matches. Both are optional here so a caller that predates the union (and
// every test fixture) still type-checks as a bundle import.
export interface MatchImportResult {
  path: string
  imported: number
  skipped: number
  kind?: 'bundle' | 'coach_notes'
  // The staged return sheet, on the coach_notes arm only. Typed loosely on
  // purpose: this composable never reads inside it, it just hands it on.
  return?: CoachReturnSheet
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
  // A coach's notes archive was staged instead of merged: open the return
  // sheet on it (the coach store's stageImportedNotes). Nothing was written
  // to the match tables, so this arm must NOT reload — and the import chip
  // stays quiet, because the sheet the player is now looking at IS the
  // receipt. Required, not optional: an unwired host would swallow every
  // notes import silently.
  onCoachNotes: (sheet: CoachReturnSheet) => void
}

const AUTO_CLEAR_MS = 5000

export function useBackupRestore(api: BackupRestoreApi) {
  // Restore REPLACES the database and an import MERGES into it; both are
  // refused on a read-only profile and while a coaching session is open.
  // Backup is a read, so it stays available.
  const { guardWrite } = useWriteGate()
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
      // Empty path = user canceled; stay silent.
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
    if (!guardWrite()) return
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
    if (!guardWrite()) return
    if (anyBusy()) return
    importingMatches.value = true
    status.value = null
    try {
      const result = await api.importMatches()
      if (result.path) await applyImport(result)
    } catch (e) {
      status.value = { ok: false, message: `Import failed: ${String(e)}` }
    } finally {
      importingMatches.value = false
      scheduleAutoClear()
    }
  }

  // The two arms of the import: a coach's notes archive was only STAGED —
  // nothing merged, so nothing to reload, and the sheet is the receipt.
  async function applyImport(result: MatchImportResult) {
    if (result.kind === 'coach_notes' && result.return) {
      api.onCoachNotes(result.return)
      return
    }
    status.value = { ok: true, message: importMessage(result) }
    await api.reload()
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
