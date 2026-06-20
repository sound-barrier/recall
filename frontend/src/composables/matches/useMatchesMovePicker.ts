import { ref, computed, onMounted } from 'vue'
import { GetProfiles } from '@/api-client'

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
  const availableProfiles = ref<{ active: string; profiles: string[] }>({ active: '', profiles: [] })
  const movePickerOpen = ref<'live' | 'archive' | null>(null)

  const otherProfiles = computed(() =>
    availableProfiles.value.profiles.filter((p) => p !== availableProfiles.value.active),
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

  onMounted(() => {
    // Best-effort: a fetch failure leaves availableProfiles empty, which
    // suppresses the Move button rather than erroring.
    GetProfiles().then((res) => { availableProfiles.value = res }).catch(() => undefined)
  })

  return { availableProfiles, movePickerOpen, otherProfiles, beginMoveLive, beginMoveArchive, cancelMove, commitMove }
}
