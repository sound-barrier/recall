import { computed, ref, type Ref } from 'vue'

import type { DatabaseOp } from '@/composables/settings/useBackupRestore'
import { useSwapHold } from '@/composables/shared/useSwapHold'
import { useWriteGate } from '@/composables/shared/useWriteGate'

// Two-step destructive "Clear database" flow.
//
// First click arms the confirm UI (`clearConfirm = true`); second
// click executes (`clearDatabase()` calls the API, then refreshes
// records and resets the lastParsedAt timestamp). `cancelClear()`
// disarms without deleting.
//
// Extracted from App.vue so the destructive-flow shape is reusable
// (mirrors useBackupRestore's import arm/cancel) and so the
// inflight / error transitions can be unit-tested without mounting
// the full app.

export interface ClearDatabaseApi {
  clearDatabase: () => Promise<void>
  afterClear: () => Promise<void> | void
  // Called when the clear succeeds — clears any cached "last parsed"
  // timestamp that no longer makes sense after wiping the DB.
  resetLastParsedAt?: () => void
  // Surfaces an error string into the global error banner.
  onError?: (message: string) => void
  /**
   * The database store's one operation slot, shared with backup / restore /
   * import: a Clear must not run while a restore is replacing the database.
   */
  op?: Ref<DatabaseOp | null>
}

export function useClearDatabase(api: ClearDatabaseApi) {
  // The most destructive write in the app — armed UI or not, it asks the
  // gate before it wipes anything.
  const { guardWrite } = useWriteGate()
  const op = api.op ?? ref<DatabaseOp | null>(null)
  const clearingDB = computed(() => op.value === 'clear')
  const clearConfirm = ref(false)
  // "Delete N Records" takes "Clear Database…"'s place: held for a beat after
  // arming, so a double-click on Clear cannot be its own confirm.
  const { held: clearConfirmHeld, hold: holdClearConfirm } = useSwapHold()

  async function clearDatabase() {
    if (clearConfirmHeld.value || op.value !== null) return
    if (!guardWrite()) return
    op.value = 'clear'
    clearConfirm.value = false
    try {
      await api.clearDatabase()
      await api.afterClear()
      api.resetLastParsedAt?.()
    } catch (e) {
      api.onError?.(String(e))
    } finally {
      op.value = null
    }
  }

  function armClear() {
    if (op.value !== null) return
    clearConfirm.value = true
    holdClearConfirm()
  }

  function cancelClear() {
    clearConfirm.value = false
  }

  return { clearingDB, clearConfirm, clearConfirmHeld, clearDatabase, armClear, cancelClear }
}
