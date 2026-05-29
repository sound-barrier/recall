import { ref, computed, watch, type Ref } from 'vue'
import type { MatchRecord } from '../api'

// Drives the detail-panel pattern from UI_RECOMMENDATIONS item #3.
//
// The Matches view used to expand each card inline; this composable
// flips the model to "one panel, one selected match key, paginated
// via the filteredSorted list". The panel itself reads `selectedKey`
// + `selectedRecord` and renders the chrome around them.
//
// Why a composable, not just refs in App.vue:
//   1. Auto-close when the selected match leaves the filtered set —
//      the user changes a filter or hides the match, the panel
//      should follow the data, not strand the user on a row that no
//      longer exists.
//   2. Prev / next encapsulation. The math is "find current index in
//      filteredSorted, +/-1, clamp" — fine inline, but the panel
//      template would call canPrev / canNext / openPrev / openNext
//      on every render, and bundling them into one returned API
//      shape keeps the consumer terse.
//   3. Future detail-panel keyboard nav (`j`/`k` while open) needs
//      the same prev/next primitives — composing here puts them in
//      one spot.

export function useSelectedMatch(filteredSorted: Readonly<Ref<MatchRecord[]>>) {
  const selectedKey = ref<string>('')

  const isOpen = computed(() => selectedKey.value !== '')

  // Index of the selected match within the *currently filtered* list.
  // Returns -1 when the panel is closed OR when the selected row has
  // been filtered out (e.g. user added a filter clause that excludes
  // it). The watch below auto-closes in that latter case, so consumers
  // generally see -1 only when the panel is closed.
  const selectedIndex = computed(() => {
    if (!selectedKey.value) return -1
    return filteredSorted.value.findIndex(r => r.match_key === selectedKey.value)
  })

  const selectedRecord = computed<MatchRecord | null>(() => {
    const idx = selectedIndex.value
    if (idx < 0) return null
    return filteredSorted.value[idx] ?? null
  })

  const canPrev = computed(() => selectedIndex.value > 0)
  const canNext = computed(() => {
    const idx = selectedIndex.value
    return idx >= 0 && idx < filteredSorted.value.length - 1
  })

  function open(matchKey: string) {
    selectedKey.value = matchKey
  }

  function close() {
    selectedKey.value = ''
  }

  function openPrev() {
    const idx = selectedIndex.value
    if (idx <= 0) return
    const prev = filteredSorted.value[idx - 1]
    if (prev) selectedKey.value = prev.match_key
  }

  function openNext() {
    const idx = selectedIndex.value
    if (idx < 0 || idx >= filteredSorted.value.length - 1) return
    const next = filteredSorted.value[idx + 1]
    if (next) selectedKey.value = next.match_key
  }

  // Auto-close when the selected match leaves the filter result.
  // Triggered by: user typing a filter clause that excludes it, the
  // user hiding the match, a re-parse dropping the row. Without this
  // the panel would render an empty body (or stale data) and the
  // user would be stuck.
  watch(filteredSorted, (next) => {
    if (!selectedKey.value) return
    if (!next.some(r => r.match_key === selectedKey.value)) {
      selectedKey.value = ''
    }
  })

  return {
    selectedKey,
    selectedIndex,
    selectedRecord,
    isOpen,
    canPrev,
    canNext,
    open,
    close,
    openPrev,
    openNext,
  }
}
