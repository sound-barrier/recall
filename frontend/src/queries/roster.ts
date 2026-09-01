import { useQuery } from '@tanstack/vue-query'

import { ListRoster, SaveRosterMember, DeleteRosterMember } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// The saved roster. Small, rarely changing, and read by two surfaces — the
// journal's member chips and the Settings section that maintains it — so it
// lives in the cache rather than in either of them.

export function useRosterQuery() {
  return useQuery({ queryKey: qk.roster, queryFn: ListRoster }, getQueryClient())
}

function refetchRoster(): Promise<unknown> {
  // Refetch rather than invalidate: this query is never gated, so the
  // observer is live and a refetch lands immediately.
  return getQueryClient().refetchQueries({ queryKey: qk.roster })
}

export async function saveRosterMember(tag: string, displayName: string, note = ''): Promise<void> {
  await SaveRosterMember(tag, displayName, note)
  await refetchRoster()
}

export async function removeRosterMember(tag: string): Promise<void> {
  await DeleteRosterMember(tag)
  await refetchRoster()
}
