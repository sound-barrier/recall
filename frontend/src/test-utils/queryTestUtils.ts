import { getQueryClient } from '@/queries/client'

// Seed server state for a test the way production receives it — through the
// query cache — instead of assigning store refs: the migrated store members
// are read-only computeds over the cache. Pair with a key from @/queries/keys.
export function seedQuery(key: readonly unknown[], data: unknown): void {
  getQueryClient().setQueryData(key as unknown[], data)
}
