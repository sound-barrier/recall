import { ref } from 'vue'

import { SetMatchVisibility } from '@/api-client'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

export interface UndoHideToastState { matchKeys: string[]; label: string; token: number }

// Inline "Undo" toast for hiding a match. Hide moves the match to the archive
// drawer, which is easy to miss — this closes the loop with a bottom-right toast
// whose "Undo" un-hides it in place. Mirrors useAnchorToast: the composable owns
// the state + the un-hide round-trip; AppOverlays renders MatchUndoToast.
//
// `token` is the React-style fresh key — bumped on each hide so a back-to-back
// hide restarts the auto-dismiss countdown in the toast component.
export function useUndoHideToast() {
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()

  const undoHideToast = ref<UndoHideToastState | null>(null)
  let token = 0

  function showUndoHide(matchKeys: string[], label: string) {
    if (matchKeys.length === 0) return
    token += 1
    undoHideToast.value = { matchKeys, label, token }
  }

  async function onUndoHide() {
    const keys = undoHideToast.value?.matchKeys ?? []
    undoHideToast.value = null
    if (keys.length === 0) return
    try {
      await Promise.all(keys.map((k) => SetMatchVisibility(k, false)))
      await matchesStore.load()
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
    }
  }

  function onUndoHideDismiss(t: number) {
    if (undoHideToast.value?.token === t) undoHideToast.value = null
  }

  return { undoHideToast, showUndoHide, onUndoHide, onUndoHideDismiss }
}
