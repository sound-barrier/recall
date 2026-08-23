import { ref } from 'vue'

import { GetDatabaseHealth, RunDatabaseMaintenance, type DBHealth } from '@/api-client'
import { useAppStore } from '@/stores/app'

export type MaintenanceKind = 'check' | 'optimize' | 'vacuum'

/**
 * The database's own report on itself, and the two maintenance passes.
 *
 * Deliberately NOT a cached query. Every one of these is a button the user
 * pressed to find out about the database RIGHT NOW — a stale integrity check
 * is worse than no check, and `optimize` / `vacuum` change the thing they are
 * reporting on. That is the written rationale TECHNICAL_DEBT.md section 16
 * records as a legitimate carve-out from the query layer; the part that was
 * not legitimate was the component reaching for the api seam to do it.
 */
export function useDatabaseHealth() {
  const report = ref<DBHealth | null>(null)
  const busy = ref<MaintenanceKind | null>(null)

  async function run(kind: MaintenanceKind): Promise<void> {
    if (busy.value) return
    busy.value = kind
    try {
      report.value = kind === 'check'
        ? await GetDatabaseHealth()
        : await RunDatabaseMaintenance(kind)
    } catch (e) {
      // Resolved lazily: the store is only needed on failure, and the parent's
      // unit tests mount the row without a Pinia.
      useAppStore().setErrorFromRaw(String(e))
    } finally {
      busy.value = null
    }
  }

  return { report, busy, run }
}
