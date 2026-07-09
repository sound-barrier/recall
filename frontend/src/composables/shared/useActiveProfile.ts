import { ref } from 'vue'
import { GetProfiles } from '@/api-client'

// Session-scoped singleton exposing whether the ACTIVE profile is read-only
// (the tour's sample "test" profile). Read by the surfaces that would otherwise
// let a user attempt a write the backend rejects with 409 — the Parse tab,
// Backup & Restore, the manual-match "Add" affordance, the masthead chip.
//
// A profile switch always does a full window.location.reload() (see
// useProfileSwitcher), so a single fetch per page load is always fresh — no
// invalidation-on-switch needed.

const isReadOnly = ref(false)
const activeName = ref('')
let started = false

async function load() {
  try {
    const res = await GetProfiles()
    activeName.value = res.active
    isReadOnly.value = (res.immutable ?? []).includes(res.active)
  } catch (_) {
    isReadOnly.value = false
  }
}

export function useActiveProfile() {
  if (!started) {
    started = true
    void load()
  }
  return { isReadOnly, activeName, reloadActiveProfile: load }
}
