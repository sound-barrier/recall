import { useQuery } from '@tanstack/vue-query'

import { GetProfiles } from '@/api-client'
import { queryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// One cache entry serves every profiles consumer (first-run gate,
// active-profile flag, masthead switcher, move picker, Settings panel).
// Freshness never matters across a switch: switching reloads the page,
// which discards the whole cache. The one non-reload write (DeleteProfile)
// invalidates below.
export function useProfilesQuery() {
  return useQuery({ queryKey: qk.profiles, queryFn: GetProfiles }, queryClient)
}

export function invalidateProfiles(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: qk.profiles })
}
