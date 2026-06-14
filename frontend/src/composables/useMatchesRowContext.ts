import { ref, type Ref } from 'vue'

import type { MatchRecord } from '@/api'
import { summaryThumbnailURL } from '@/composables/useSummaryThumbnail'

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
  // Floats a small thumbnail of the SUMMARY screenshot next to the
  // cursor on hover. State is intentionally minimal: src + cursor
  // coords. Mouseenter sets src, mousemove updates coords, mouseleave
  // clears src. The preview component is mounted at the top level
  // (Teleport to body) so it doesn't get stacking-context surprises.
  const hoverPreviewSrc = ref<string | null>(null)
  const hoverPreviewX = ref(0)
  const hoverPreviewY = ref(0)

  function onLeafMouseEnter(rec: MatchRecord, e: MouseEvent) {
    hoverPreviewSrc.value = summaryThumbnailURL(rec)
    hoverPreviewX.value = e.clientX
    hoverPreviewY.value = e.clientY
  }

  function onLeafMouseMove(e: MouseEvent) {
    // Only update coords; src is set on enter so the preview tracks the
    // cursor without re-resolving the thumbnail on every move.
    if (!hoverPreviewSrc.value) return
    hoverPreviewX.value = e.clientX
    hoverPreviewY.value = e.clientY
  }

  function onLeafMouseLeave() {
    hoverPreviewSrc.value = null
  }

  return {
    rowContextMenu,
    onRowContext,
    onRowContextClose,
    replayCodeFor,
    hoverPreviewSrc,
    hoverPreviewX,
    hoverPreviewY,
    onLeafMouseEnter,
    onLeafMouseMove,
    onLeafMouseLeave,
  }
}
