import { ref, computed } from 'vue'
import { useProfilesQuery } from '@/queries/profiles'

// The cross-profile move picker shared by the live bulk-action bar and the
// archive drawer: a two-step affordance (Move to… → pick a target profile
// chip → fire move-matches and clear that side's selection). One open-mode
// flag ('live' | 'archive' | null) tracks which bar opened it. The other-
// profiles list is fetched once on mount; an empty list suppresses the Move
// button (a one-profile install has nowhere to move). Extracted from
// MatchesView so the shell sheds this cross-cutting state.
export function useMatchesMovePicker(opts: {
  liveKeys: () => string[]
  archiveKeys: () => string[]
  clearLive: () => void
  clearArchive: () => void
  onMove: (keys: string[], targetProfile: string) => void
}) {
  // Backed by the shared profiles query — a fetch failure leaves the list
  // empty, which suppresses the Move button rather than erroring.
  const profilesQuery = useProfilesQuery()
  const availableProfiles = computed(() => {
    const res = profilesQuery.data.value
    return res
      ? { active: res.active, profiles: res.profiles, immutable: res.immutable ?? [] }
      : { active: '', profiles: [], immutable: [] }
  })
  const movePickerOpen = ref<'live' | 'archive' | null>(null)

  // Read-only profiles (the tour's sample) reject a move-in server-side, so
  // exclude them from the target list along with the active profile itself.
  const otherProfiles = computed(() =>
    availableProfiles.value.profiles.filter(
      (p) => p !== availableProfiles.value.active && !availableProfiles.value.immutable.includes(p),
    ),
  )

  function beginMoveLive() {
    if (otherProfiles.value.length === 0) return
    movePickerOpen.value = 'live'
  }
  function beginMoveArchive() {
    if (otherProfiles.value.length === 0) return
    movePickerOpen.value = 'archive'
  }
  function cancelMove() {
    movePickerOpen.value = null
  }
  function commitMove(target: string) {
    if (movePickerOpen.value === 'live') {
      const keys = opts.liveKeys()
      if (keys.length === 0) return
      opts.clearLive()
      movePickerOpen.value = null
      opts.onMove(keys, target)
      return
    }
    if (movePickerOpen.value === 'archive') {
      const keys = opts.archiveKeys()
      if (keys.length === 0) return
      opts.clearArchive()
      movePickerOpen.value = null
      opts.onMove(keys, target)
    }
  }

  return { availableProfiles, movePickerOpen, otherProfiles, beginMoveLive, beginMoveArchive, cancelMove, commitMove }
}
