import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'

import { ARM_WINDOW_MS } from '@/composables/unknown/useArmedAction'

/**
 * One row a section can tick.
 *
 * `id` is whatever that section already keys on — match_key for the
 * unmatched and ambiguous cards, filename for failed rows, which have no
 * match_key at all. `files` is every screenshot dismissing the row would
 * suppress, because a card is dismissed WHOLE: leaving one file behind would
 * still back the match and the card would come straight back.
 */
export interface UnknownSelectableRow {
  id: string
  files: string[]
}

/**
 * How a ticked row names itself.
 *
 * A one-file row is best identified by its filename — that is what the user
 * is looking at. A multi-file card has no single filename to answer to, so it
 * falls back to the key it is already labeled by on screen.
 */
export function unknownRowLabel(files: readonly string[], key: string): string {
  return files.length === 1 ? (files[0] ?? key) : key
}

export interface UseUnknownSelectionOptions {
  /** The section's rows as they stand now, read fresh on every derivation. */
  rows: () => UnknownSelectableRow[]
  /** Fired once, with every file behind the ticked rows. */
  onDismissFiles: (files: string[]) => void
}

/**
 * Ticked-row selection and the two-click bulk dismiss for one Unknown-tab
 * section.
 *
 * Per section, not per view: the three dismissable sections key differently,
 * and instances are independent — the same reason useArmedAction is
 * instantiated per section — so ticking a failed row can never raise a bar
 * over the cards.
 *
 * The effective selection is the ticked ids INTERSECTED with the rows that
 * are still there. A parse run can retire a row while it is ticked, and a
 * stale id must not inflate the count the confirm is about.
 */
export function useUnknownSelection(opts: UseUnknownSelectionOptions) {
  const selectedIds = ref<Set<string>>(new Set())
  // The armed confirm is about the file set as it stood when it was armed;
  // any change to that set has to disarm, or the user confirms one thing and
  // dismisses another.
  const armed = ref(false)

  // A row carrying no files cannot be dismissed — the per-card path hides its
  // button outright — so it is not selectable either. Counting one would arm a
  // confirm over a card that then quietly survives the sweep.
  const selectable = (r: UnknownSelectableRow) => r.files.length > 0

  const selectedRows: ComputedRef<UnknownSelectableRow[]> = computed(() =>
    opts.rows().filter((r) => selectable(r) && selectedIds.value.has(r.id)),
  )
  const selectedCount = computed(() => selectedRows.value.length)
  const selectedFiles = computed(() => [...new Set(selectedRows.value.flatMap((r) => r.files))])

  let armTimer: ReturnType<typeof setTimeout> | undefined
  onScopeDispose(() => { clearTimeout(armTimer) })

  // The armed confirm is about a FILE SET, and the ids are only half of what
  // determines it: a parse run can merge a new screenshot into a ticked match
  // under the same key, growing what Confirm would suppress without the user
  // touching anything. Watching the files themselves is what makes the
  // invariant true rather than merely stated.
  // flush: 'sync' because the disarm has to happen AT the change, not a tick
  // later: a deferred run would land after the next requestDismiss() and
  // silently un-arm a confirm the user had just raised.
  watch(() => selectedFiles.value.join('\u0000'), () => {
    armed.value = false
    clearTimeout(armTimer)
  }, { flush: 'sync' })

  function replaceSelection(next: Set<string>) {
    selectedIds.value = next
    armed.value = false
    clearTimeout(armTimer)
  }

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id)
  }

  function setSelected(id: string, on: boolean) {
    const next = new Set(selectedIds.value)
    if (on && opts.rows().some((r) => r.id === id && selectable(r))) next.add(id)
    else next.delete(id)
    replaceSelection(next)
  }

  function toggleSelected(id: string) {
    setSelected(id, !selectedIds.value.has(id))
  }

  function clearSelection() {
    replaceSelection(new Set())
  }

  function selectAll() {
    replaceSelection(new Set(opts.rows().filter(selectable).map((r) => r.id)))
  }

  function requestDismiss() {
    if (selectedCount.value === 0) return
    armed.value = true
    clearTimeout(armTimer)
    // Auto-disarm, exactly like the per-card button. This is the ONE control
    // here that suppresses many files at once, so it should be no braver than
    // its single-card sibling.
    armTimer = setTimeout(() => { armed.value = false }, ARM_WINDOW_MS)
  }

  function cancelDismiss() {
    armed.value = false
    clearTimeout(armTimer)
  }

  function commitDismiss() {
    clearTimeout(armTimer)
    const files = selectedFiles.value
    if (files.length === 0) {
      // Every ticked row went away between arming and confirming. Collapse
      // rather than firing an empty write.
      clearSelection()
      return
    }
    clearSelection()
    opts.onDismissFiles(files)
  }

  return {
    selectedIds: selectedIds as Ref<Set<string>>,
    armed,
    selectedRows,
    selectedCount,
    selectedFiles,
    isSelected,
    setSelected,
    toggleSelected,
    clearSelection,
    selectAll,
    requestDismiss,
    cancelDismiss,
    commitDismiss,
  }
}

export type UnknownSelectionApi = ReturnType<typeof useUnknownSelection>
