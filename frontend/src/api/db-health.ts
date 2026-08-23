import { unwrap } from '@/api-unwrap'
import * as sdk from '@/client/sdk.gen'
import type { DBHealth } from '@/api/types'

// Re-exported wire types — consumers import these instead of reaching into
// the generated module directly.

// ─── Database health / maintenance ─────────────────────────────────────────

export function GetDatabaseHealth(): Promise<DBHealth> {
  return unwrap(sdk.getDatabaseHealth())
}

export function RunDatabaseMaintenance(operation: 'optimize' | 'vacuum'): Promise<DBHealth> {
  return unwrap(sdk.runDatabaseMaintenance({ body: { operation } }))
}
