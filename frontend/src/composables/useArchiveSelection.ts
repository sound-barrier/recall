import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { MatchRecord } from '../api'

// Archive-drawer selection state and the bulk-action handlers that
// drive its action bar. Extracted from MatchesView as the first step
// in the item-7 burn-down (TECHNICAL_DEBT.md) — full template +
// styles extraction is the larger follow-up.
//
// Shape mirrors the inline live-selection handlers in MatchesView so
// the two stay legible side-by-side. Two emit channels are exposed
// as opaque callbacks (rather than a Vue emit instance) so the
// composable stays plain TS and easy to unit-test.

export interface UseArchiveSelectionOptions {
  // The full record list off MatchesView's props. The composable
  // filters to `r.hidden === true` itself; callers don't need to
  // pre-filter.
  records: Ref<MatchRecord[]> | ComputedRef<MatchRecord[]>
  // Fired when the user clicks `Unhide` on the bulk action bar.
  onUnhideMatches: (matchKeys: string[]) => void
  // Fired when the user confirms the second click of the two-step
  // bulk Delete-forever. Passes every ticked archive key.
  onHardDeleteMatches: (matchKeys: string[]) => void
}

export interface UseArchiveSelectionApi {
  // Drawer open/close — local toggle backing the chevron in the
  // archive header.
  archiveOpen: Ref<boolean>

  // Selection state. `archiveSelectedKeys` is the ticked set;
  // `archiveConfirmKey` is the per-row two-step confirm target
  // (null when nothing is armed). `archiveBulkConfirm` is the
  // bulk-delete two-step.
  archiveSelectedKeys: Ref<Set<string>>
  archiveConfirmKey: Ref<string | null>
  archiveBulkConfirm: Ref<boolean>

  // Derived: the hidden subset of `records`.
  hiddenRecords: ComputedRef<MatchRecord[]>
  visibleRecords: ComputedRef<MatchRecord[]>

  // Per-row selection.
  toggleArchiveSelected: (key: string) => void
  clearArchiveSelection: () => void
  selectAllArchive: () => void

  // Bulk actions. unhideSelectedArchive fans out the unhide event;
  // request → cancel → commit drive the two-step confirm for
  // bulk hard-delete.
  unhideSelectedArchive: () => void
  requestBulkHardDelete: () => void
  cancelBulkHardDelete: () => void
  commitBulkHardDelete: () => void

  // Per-row two-step delete.
  confirmHardDelete: (matchKey: string) => void
  cancelHardDelete: () => void
}

export function useArchiveSelection(
  opts: UseArchiveSelectionOptions,
): UseArchiveSelectionApi {
  const archiveOpen = ref(false)
  const archiveSelectedKeys = ref<Set<string>>(new Set())
  // Two-step confirm: `archiveConfirmKey` targets one row's inline
  // confirm; `archiveBulkConfirm` targets the bulk action bar's
  // bulk-delete confirm. Both clear whenever the selection mutates
  // — the user's prior "Confirm" no longer corresponds to the same
  // target set.
  const archiveConfirmKey = ref<string | null>(null)
  const archiveBulkConfirm = ref(false)

  const hiddenRecords = computed(() =>
    opts.records.value.filter((r) => r.hidden),
  )
  const visibleRecords = computed(() =>
    opts.records.value.filter((r) => !r.hidden),
  )

  function toggleArchiveSelected(key: string) {
    const next = new Set(archiveSelectedKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    archiveSelectedKeys.value = next
    archiveBulkConfirm.value = false
  }

  function clearArchiveSelection() {
    archiveSelectedKeys.value = new Set()
    archiveBulkConfirm.value = false
  }

  function selectAllArchive() {
    const keys = hiddenRecords.value.map((r) => r.match_key)
    archiveSelectedKeys.value = new Set(keys)
    archiveBulkConfirm.value = false
  }

  function unhideSelectedArchive() {
    const keys = [...archiveSelectedKeys.value]
    if (keys.length === 0) return
    clearArchiveSelection()
    opts.onUnhideMatches(keys)
  }

  function requestBulkHardDelete() {
    if (archiveSelectedKeys.value.size === 0) return
    archiveBulkConfirm.value = true
  }

  function cancelBulkHardDelete() {
    archiveBulkConfirm.value = false
  }

  function commitBulkHardDelete() {
    const keys = [...archiveSelectedKeys.value]
    if (keys.length === 0) return
    clearArchiveSelection()
    opts.onHardDeleteMatches(keys)
  }

  function confirmHardDelete(key: string) {
    archiveConfirmKey.value = key
  }

  function cancelHardDelete() {
    archiveConfirmKey.value = null
  }

  return {
    archiveOpen,
    archiveSelectedKeys,
    archiveConfirmKey,
    archiveBulkConfirm,
    hiddenRecords,
    visibleRecords,
    toggleArchiveSelected,
    clearArchiveSelection,
    selectAllArchive,
    unhideSelectedArchive,
    requestBulkHardDelete,
    cancelBulkHardDelete,
    commitBulkHardDelete,
    confirmHardDelete,
    cancelHardDelete,
  }
}
