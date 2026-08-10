import { useProfilesData } from '@/queries/profiles'

// Whether the ACTIVE profile is read-only (the tour's sample "test"
// profile). Read by the surfaces that would otherwise let a user attempt a
// write the backend rejects with 409 — the Parse tab, Backup & Restore,
// the manual-match "Add" affordance, the masthead chip.
//
// Backed by the shared profiles query, so all consumers ride one GET per
// page load. A profile switch always does a full window.location.reload()
// (see useProfileSwitcher), so that single fetch is always fresh. An error
// leaves the value at its permissive default (writable).
export function useActiveProfile() {
  const { isReadOnly } = useProfilesData()
  return { isReadOnly }
}
