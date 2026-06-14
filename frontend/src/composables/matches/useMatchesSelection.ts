import { ref } from 'vue'
import type { MatchRecord, PlayMode, QueueType } from '@/api'

// Gmail-style row selection + bulk writers for the live matches list. The
// checkbox on each row toggles a key into the set; a contextual action bar
// appears while the set is non-empty. Every bulk action snapshots the keys
// (the user could tick more rows mid-flight), clears the selection so the
// bar collapses, then hands the keys to the caller's writer — App.vue owns
// the actual api.ts call + reload. Selection clears optimistically because
// keeping checkboxes lit through an in-flight write would strand stale
// state if the reload re-orders the list. Extracted from MatchesView.
export function useMatchesSelection(opts: {
  narrowedRecords: () => MatchRecord[]
  onHide: (keys: string[]) => void
  onBulkPlayMode: (keys: string[], playMode: PlayMode) => void
  onBulkQueue: (keys: string[], queueType: QueueType) => void
  onBulkTag: (keys: string[], tag: string) => void
}) {
  const selectedKeys = ref<Set<string>>(new Set())

  function toggleSelected(key: string) {
    const next = new Set(selectedKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selectedKeys.value = next
  }

  function clearSelection() {
    selectedKeys.value = new Set()
  }

  function hideSelected() {
    const keys = [...selectedKeys.value]
    if (keys.length === 0) return
    clearSelection()
    opts.onHide(keys)
  }

  // Select-all targets the narrowed + sorted set the user sees; no-op when
  // empty.
  function selectAllVisible() {
    selectedKeys.value = new Set(opts.narrowedRecords().map((r) => r.match_key))
  }

  function onBulkPlayMode(playMode: PlayMode) {
    const keys = [...selectedKeys.value]
    if (keys.length === 0) return
    clearSelection()
    opts.onBulkPlayMode(keys, playMode)
  }

  function onBulkQueue(queueType: QueueType) {
    const keys = [...selectedKeys.value]
    if (keys.length === 0) return
    clearSelection()
    opts.onBulkQueue(keys, queueType)
  }

  function onBulkTag(tag: string) {
    const keys = [...selectedKeys.value]
    if (keys.length === 0) return
    clearSelection()
    opts.onBulkTag(keys, tag)
  }

  return { selectedKeys, toggleSelected, clearSelection, hideSelected, selectAllVisible, onBulkPlayMode, onBulkQueue, onBulkTag }
}
