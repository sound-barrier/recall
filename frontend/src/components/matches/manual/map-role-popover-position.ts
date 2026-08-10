// Anchored placement for the Geography (Map × Role) gear popover.
//
// Pure geometry, kept out of MapRoleConfigPopover.vue's `<script setup>` per
// the layering rule: it is the component's only branch-dense logic and the
// only way to exercise it is to feed it a rect, because happy-dom reports
// zeros for every layout API. Living here it gets a direct unit test instead
// of an untestable `.style` read.

export interface AnchorRect {
  top: number
  bottom: number
  right: number
}

export interface Viewport {
  width: number
  height: number
}

// The popover's fixed width, and the typical height of a filled render. The
// height is an ESTIMATE used only to decide whether to flip above the anchor
// — the real height is clamped at render time by the returned maxHeight.
export const POPOVER_WIDTH = 300
export const POPOVER_HEIGHT_ESTIMATE = 380
export const VIEWPORT_PADDING = 8
const ANCHOR_GAP = 6

// popoverPosition returns the popover's inline style: hidden until the gear
// has reported its rect, otherwise pinned under the gear and right-aligned to
// it. It flips above only when the space below cannot hold the popover AND
// the space above is larger — flipping into an even tighter gap would be
// worse than staying put. Both axes clamp so no edge leaves the viewport.
export function popoverPosition(
  anchor: AnchorRect | null,
  viewport: Viewport,
): Record<string, string> {
  if (!anchor) return { display: 'none' }
  const roomBelow = viewport.height - (anchor.bottom + ANCHOR_GAP)
  const flipAbove = roomBelow < POPOVER_HEIGHT_ESTIMATE && anchor.top - ANCHOR_GAP > roomBelow
  const top = flipAbove
    ? Math.max(VIEWPORT_PADDING, anchor.top - ANCHOR_GAP - POPOVER_HEIGHT_ESTIMATE)
    : Math.max(VIEWPORT_PADDING, anchor.bottom + ANCHOR_GAP)
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(anchor.right - POPOVER_WIDTH, viewport.width - POPOVER_WIDTH - VIEWPORT_PADDING),
  )
  return {
    top: `${top}px`,
    left: `${left}px`,
    maxHeight: `${viewport.height - top - VIEWPORT_PADDING}px`,
  }
}
