import { ref, nextTick } from 'vue'

import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

export interface AnchorToastState { kind: 'set' | 'cleared'; label: string; token: number }

// "Since this match" anchor toast — the cause→effect bridge between the
// detail-panel anchor toggle and the narrow-panel filter. Setting/clearing the
// anchor (frontend-only; matchAnchor persists it in localStorage) stamps a
// bottom-right confirmation toast; the toast's "view filter" tap jumps to
// Matches + opens the narrow popover the same way a user would. Lives in a
// composable (not a store) because the view-filter reaches into the DOM.
export function useAnchorToast() {
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()

  const anchorToast = ref<AnchorToastState | null>(null)
  // React-style fresh key so back-to-back changes reset the auto-dismiss window.
  let token = 0

  function onSetAnchor(matchKey: string) {
    token += 1
    if (matchKey === '') {
      matchesStore.matchAnchor.clearAnchor()
      anchorToast.value = { kind: 'cleared', label: '', token }
      return
    }
    matchesStore.matchAnchor.setAnchor(matchKey)
    const rec = matchesStore.records.find((r) => r.match_key === matchKey)
    const date = rec?.data?.date ?? ''
    const map = rec?.data?.map ?? '—'
    anchorToast.value = { kind: 'set', label: date ? `${date} · ${map}` : map, token }
  }

  async function onAnchorToastViewFilter() {
    if (appStore.view !== 'matches') await appStore.goToView('matches')
    await nextTick()
    document.querySelector<HTMLButtonElement>('[data-narrow-trigger]')?.click()
  }

  function onAnchorToastDismiss(t: number) {
    if (anchorToast.value?.token === t) anchorToast.value = null
  }

  return { anchorToast, onSetAnchor, onAnchorToastViewFilter, onAnchorToastDismiss }
}
