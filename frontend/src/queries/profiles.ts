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

// Renaming does NOT invalidate, on purpose. Its only caller is the first-run
// modal, whose contract is that the parent reloads the window afterwards so
// the masthead chip rebinds — a reload discards the whole cache, so awaiting a
// refetch first is work thrown away. It was worse than pointless when it was
// here: the refetch settled after the reload had already begun, and the modal
// never reached its second step.
//
// It stays a wrapper because the rule is that components do not import the api
// seam, not that every write must invalidate.
export function renameProfile(from: string, to: string) {
  return RenameProfile(from, to)
}

// Deleting DOES invalidate: nothing reloads after it, so the list on screen is
// the one that has to change.
export async function deleteProfile(name: string): Promise<void> {
  await DeleteProfile(name)
  await invalidateProfiles()
}
