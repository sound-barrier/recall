// Anchored placement for the Matches list's combined Sort + Group popover.
//
// Pure geometry, kept out of MatchesSortGroupPopover.vue's `<script setup>`
// per the layering rule: happy-dom reports zeros for every layout API, so the
// only way to exercise the flip / clamp decisions is to hand them a rect —
// and asserting them through the component would mean reading `.style`, which
// the unit suite forbids. Sibling of manual/map-role-popover-position.ts; the
// two share a shape, not a formula (this popover is left-aligned, has no
// fixed width, and flips on room-below alone).

export interface AnchorRect {
  top: number
  bottom: number
  left: number
}

// The typical height of a filled render. It decides ONLY whether to flip above
// the trigger — the real height is clamped at render time by `maxHeight`.
export const POPOVER_HEIGHT_ESTIMATE = 240
export const VIEWPORT_PADDING = 8
const ANCHOR_GAP = 6

// sortGroupPopoverPosition returns the popover's inline style: hidden until
// the trigger has reported its rect, otherwise pinned under the trigger and
// left-aligned to it. It flips above whenever the space below can't hold the
// estimate (a short window, or Playwright's auto-scroll pinning the trigger
// near the viewport foot). Both the top and the left clamp to the viewport
// padding so no edge leaves the page.
export function sortGroupPopoverPosition(
  anchor: AnchorRect | null,
  viewportHeight: number,
): Record<string, string> {
  if (!anchor) return { display: 'none' }
  const roomBelow = viewportHeight - (anchor.bottom + ANCHOR_GAP)
  const flipAbove = roomBelow < POPOVER_HEIGHT_ESTIMATE
  const top = flipAbove
    ? Math.max(VIEWPORT_PADDING, anchor.top - ANCHOR_GAP - POPOVER_HEIGHT_ESTIMATE)
    : Math.max(VIEWPORT_PADDING, anchor.bottom + ANCHOR_GAP)
  return {
    top:       `${top}px`,
    left:      `${Math.max(VIEWPORT_PADDING, anchor.left)}px`,
    maxHeight: `${viewportHeight - top - VIEWPORT_PADDING}px`,
    overflowY: 'auto',
  }
}
