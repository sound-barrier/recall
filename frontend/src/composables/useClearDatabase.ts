import { ref } from 'vue'

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
}

export function useClearDatabase(api: ClearDatabaseApi) {
  const clearingDB = ref(false)
  const clearConfirm = ref(false)

  async function clearDatabase() {
    clearingDB.value = true
    clearConfirm.value = false
    try {
      await api.clearDatabase()
      await api.afterClear()
      api.resetLastParsedAt?.()
    } catch (e) {
      api.onError?.(String(e))
    } finally {
      clearingDB.value = false
    }
  }

  function armClear() {
    clearConfirm.value = true
  }

  function cancelClear() {
    clearConfirm.value = false
  }

  return { clearingDB, clearConfirm, clearDatabase, armClear, cancelClear }
}
