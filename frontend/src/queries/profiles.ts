import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'

import { GetProfiles } from '@/api-client'
import { queryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// One cache entry serves every profiles consumer (first-run gate,
// active-profile flag, masthead switcher, move picker, Settings panel).
// Freshness never matters across a switch: switching reloads the page,
// which discards the whole cache. The one non-reload write (DeleteProfile)
// invalidates below.
function useProfilesQuery() {
  return useQuery({ queryKey: qk.profiles, queryFn: GetProfiles }, queryClient)
}

// The shared derived layer over the profiles response — the ONE place the
// field fallbacks are spelled, so a ProfilesResponse change is a one-file
// fix instead of a five-consumer hunt. Every value is permissive on
// error/loading: empty list, unnamed active, nothing immutable, writable.
export function useProfilesData() {
  const query = useProfilesQuery()
  const profiles = computed(() => query.data.value?.profiles ?? [])
  const active = computed(() => query.data.value?.active ?? '')
  const immutable = computed(() => query.data.value?.immutable ?? [])
  const isReadOnly = computed(() => immutable.value.includes(active.value) && active.value !== '')
  return { query, profiles, active, immutable, isReadOnly }
}

export function invalidateProfiles(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: qk.profiles })
}
