import { computed } from 'vue'

import { invalidateProfiles, useProfilesQuery } from '@/queries/profiles'

// Whether the ACTIVE profile is read-only (the tour's sample "test"
// profile). Read by the surfaces that would otherwise let a user attempt a
// write the backend rejects with 409 — the Parse tab, Backup & Restore,
// the manual-match "Add" affordance, the masthead chip.
//
// Backed by the shared profiles query, so all consumers ride one GET per
// page load. A profile switch always does a full window.location.reload()
// (see useProfileSwitcher), so that single fetch is always fresh. An error
// leaves both values at their permissive defaults (writable, unnamed).
export function useActiveProfile() {
  const query = useProfilesQuery()
  const isReadOnly = computed(() => {
    const res = query.data.value
    return res ? (res.immutable ?? []).includes(res.active) : false
  })
  const activeName = computed(() => query.data.value?.active ?? '')
  return { isReadOnly, activeName, reloadActiveProfile: invalidateProfiles }
}
