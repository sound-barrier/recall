import { ref, type Ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import { summaryThumbnailURL } from '@/composables/shared/useSummaryThumbnail'

// View-local state for the members-list row interactions that aren't
// the row's own concern: the right-click context menu and the
// cursor-following hover preview. MatchesView owns the *actions* (the
// menu items forward to App.vue via emits); this composable owns the
// open/close/position state machine, so the view's script stays
// orchestration. `records` is the narrowed set — used to gate the menu's
// "Copy replay code" item on whether the clicked row has a code on file.
export function useMatchesRowContext(records: Ref<MatchRecord[]>) {
  // ─── Row right-click → context menu ────────────────────────────
  //
  // Coordinates come from the native MouseEvent's clientX / clientY so
  // the menu pops up right under the cursor.
  const rowContextMenu = ref<{ x: number; y: number; matchKey: string } | null>(null)

  function onRowContext(e: MouseEvent, matchKey: string) {
    e.preventDefault()
    rowContextMenu.value = { x: e.clientX, y: e.clientY, matchKey }
  }

  function onRowContextClose() {
    rowContextMenu.value = null
  }

  // Replay-code lookup for the menu's gating (we hide "Copy replay
  // code" when the active row has no code on file). Looks up against the
  // narrowed set — for right-click on a visible row that's always
  // sufficient.
  function replayCodeFor(matchKey: string): string | null {
    return records.value.find((r) => r.match_key === matchKey)?.annotation?.replay_code ?? null
  }

  // ─── Leaf-row hover preview ────────────────────────────────────
  //
  // Floats a small card next to the cursor on hover: the SUMMARY
  // screenshot thumbnail (when there is one) plus, for an edited or
  // hand-entered match, a provenance badge — the dense cozy/compact rows
  // have no room for the Edited / User-entered columns the data table
  // carries, so the hover card is where they surface. A manual match has
  // no screenshot, so the card then shows the badge alone. Mouseenter
  // sets the state, mousemove tracks coords, mouseleave clears it. The
  // preview is mounted at the top level (Teleport to body) so it dodges
  // stacking-context surprises.
  const hoverPreviewSrc = ref<string | null>(null)
  const hoverPreviewSource = ref<MatchRecord['source']>(undefined)
  const hoverPreviewEditedFields = ref<string[]>([])
  const hoverPreviewX = ref(0)
  const hoverPreviewY = ref(0)

  // A hover card is worth floating when there's a thumbnail OR the match
  // carries provenance worth calling out (edited / hand-entered).
  function hasHoverContent(): boolean {
    const s = hoverPreviewSource.value
    return hoverPreviewSrc.value !== null || s === 'manual' || s === 'ocr_edited'
  }

  function onLeafMouseEnter(rec: MatchRecord, e: MouseEvent) {
    hoverPreviewSrc.value = summaryThumbnailURL(rec)
    hoverPreviewSource.value = rec.source
    hoverPreviewEditedFields.value = rec.edited_fields ?? []
    hoverPreviewX.value = e.clientX
    hoverPreviewY.value = e.clientY
  }

  function onLeafMouseMove(e: MouseEvent) {
    // Only update coords; the content is resolved on enter so the card
    // tracks the cursor without re-resolving on every move.
    if (!hasHoverContent()) return
    hoverPreviewX.value = e.clientX
    hoverPreviewY.value = e.clientY
  }

  function onLeafMouseLeave() {
    hoverPreviewSrc.value = null
    hoverPreviewSource.value = undefined
    hoverPreviewEditedFields.value = []
  }

  return {
    rowContextMenu,
    onRowContext,
    onRowContextClose,
    replayCodeFor,
    hoverPreviewSrc,
    hoverPreviewSource,
    hoverPreviewEditedFields,
    hoverPreviewX,
    hoverPreviewY,
    onLeafMouseEnter,
    onLeafMouseMove,
    onLeafMouseLeave,
  }
}
