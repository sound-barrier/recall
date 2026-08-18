import { computed, type Ref } from 'vue'

import { useArchiveSelection } from '@/composables/matches/list/useArchiveSelection'
import { useMatchesMovePicker } from '@/composables/matches/list/useMatchesMovePicker'
import { useMatchesSelection } from '@/composables/matches/list/useMatchesSelection'
import type { MatchRecord, PlayMode, QueueType } from '@/api-client'

/**
 * Everything the ticked-row bars can do, wired together.
 *
 * Three composables collaborate here — live selection, the archive drawer's
 * own selection, and the move-to-profile picker shared by both bars — and the
 * wiring between them is what this file is: the move picker needs both key
 * sets and both clear functions, the two selections need the same bulk
 * handlers, and hard-delete needs the drawer's two-step to be cancelled before
 * the row goes.
 *
 * That wiring has one reason to change (what the bulk bars can do to a set of
 * rows) and it is not the reason MatchesView changes, so it lives apart from
 * it. Returned flat rather than as nested bundles so the template reads the
 * same as it did when this was inline.
 */
export interface BulkActionDeps {
  narrowedRecords: Ref<MatchRecord[]>
  allRecords: () => MatchRecord[]
  hideMatches: (keys: string[]) => unknown
  unhideMatches: (keys: string[]) => unknown
  hardDeleteMatches: (keys: string[]) => unknown
  hardDeleteMatch: (key: string) => unknown
  moveMatches: (keys: string[], target: string) => unknown
  // The narrow union, not `string`: these forward to the store's typed
  // mutations, and widening here would let a caller pass a mode the API
  // rejects at runtime instead of the compiler rejecting it here.
  applyPlayMode: (keys: string[], playMode: PlayMode) => unknown
  applyQueue: (keys: string[], queueType: QueueType) => unknown
  applyTag: (keys: string[], tag: string) => unknown
}

export function useMatchesBulkActions(deps: BulkActionDeps) {
  // Live rows. Row-body clicks never touch selection — the checkbox is the
  // only selection affordance, so opening a match and choosing one stay
  // separate gestures.
  const live = useMatchesSelection({
    narrowedRecords: () => deps.narrowedRecords.value,
    onHide: (keys) => void deps.hideMatches(keys),
    onBulkPlayMode: (keys, playMode) => void deps.applyPlayMode(keys, playMode),
    onBulkQueue: (keys, queueType) => void deps.applyQueue(keys, queueType),
    onBulkTag: (keys, tag) => void deps.applyTag(keys, tag),
  })

  // Archived rows carry their own parallel selection: the drawer shows hidden
  // matches, which the narrow deliberately does not.
  const archive = useArchiveSelection({
    records: computed(() => deps.allRecords()),
    onUnhideMatches: (keys) => void deps.unhideMatches(keys),
    onHardDeleteMatches: (keys) => void deps.hardDeleteMatches(keys),
  })

  const movePicker = useMatchesMovePicker({
    liveKeys: () => [...live.selectedKeys.value],
    archiveKeys: () => [...archive.archiveSelectedKeys.value],
    clearLive: live.clearSelection,
    clearArchive: archive.clearArchiveSelection,
    onMove: (keys, target) => void deps.moveMatches(keys, target),
  })

  // The per-row two-step: disarm the confirm before the row goes, so the
  // drawer is not left holding a Confirm button for a match that no longer
  // exists.
  function commitHardDelete(key: string) {
    archive.cancelHardDelete()
    void deps.hardDeleteMatch(key)
  }

  return {
    ...live,
    // The drawer takes the whole api as one prop; the list beside it needs
    // only the visible subset, so those are the two that come out here.
    archive,
    visibleRecords: archive.visibleRecords,
    ...movePicker,
    commitHardDelete,
  }
}
