import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'

import { DeleteProfile, GetProfiles, RenameProfile } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// One cache entry serves every profiles consumer (first-run gate,
// active-profile flag, masthead switcher, move picker, Settings panel).
// Freshness never matters across a switch: switching reloads the page,
// which discards the whole cache. The one non-reload write (DeleteProfile)
// invalidates below.
function useProfilesQuery() {
  return useQuery({ queryKey: qk.profiles, queryFn: GetProfiles }, getQueryClient())
}

// The shared derived layer over the profiles response — the ONE place the
// field fallbacks are spelled, so a ProfilesResponse change is a one-file
// fix instead of a five-consumer hunt. Every value is permissive on
// error/loading: empty list, unnamed active, nothing immutable, writable.
export function useProfilesData() {
  const query = useProfilesQuery()
  const profiles = computed(() => query.data.value?.profiles ?? [])
  const active = computed(() => query.data.value?.active ?? '')
  return { query, profiles, active }
}

export function invalidateProfiles(): Promise<void> {
  return getQueryClient().invalidateQueries({ queryKey: qk.profiles })
}

// The two non-reload writes. Both invalidate the list on success, so no
// caller has to remember to — which is what the manual invalidateProfiles()
// calls beside them used to be.
export async function renameProfile(from: string, to: string) {
  const resp = await RenameProfile(from, to)
  await invalidateProfiles()
  return resp
}

export async function deleteProfile(name: string): Promise<void> {
  await DeleteProfile(name)
  await invalidateProfiles()
}
