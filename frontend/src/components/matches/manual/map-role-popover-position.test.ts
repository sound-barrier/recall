import { describe, expect, it } from 'vitest'

import {
  popoverPosition,
  POPOVER_HEIGHT_ESTIMATE,
  POPOVER_WIDTH,
  VIEWPORT_PADDING,
  type AnchorRect,
} from '@/components/matches/manual/map-role-popover-position'

// A gear button somewhere in the page; `right` is what the popover
// right-aligns to, `top`/`bottom` decide below-vs-above.
function gear(over: Partial<AnchorRect> = {}): AnchorRect {
  return { top: 100, bottom: 124, right: 900, ...over }
}

const VIEWPORT = { width: 1440, height: 900 }

describe('popoverPosition', () => {
  it('stays hidden until the gear has reported its rect', () => {
    expect(popoverPosition(null, VIEWPORT)).toEqual({ display: 'none' })
  })

  it('pins under the gear and right-aligns to it when there is room below', () => {
    // 900 - (124 + 6) = 770 of room below, more than the 380 estimate.
    expect(popoverPosition(gear(), VIEWPORT)).toEqual({
      top: '130px',
      left: '600px', // right (900) - width (300)
      maxHeight: '762px', // 900 - 130 - 8
    })
  })

  it('flips above the gear when the space below cannot hold it and above is roomier', () => {
    // Gear near the foot: 40px below, 780px above.
    const pos = popoverPosition(gear({ top: 800, bottom: 860 }), VIEWPORT)
    // 800 - 6 - 380 = 414 — clear of the anchor, off the bottom edge.
    expect(pos.top).toBe('414px')
  })

  it('stays below when neither side fits, rather than flipping into a tighter gap', () => {
    // A short viewport: 100 below the gear, only 30 above it. Neither holds
    // the popover, so it keeps the larger gap instead of flipping.
    const pos = popoverPosition(gear({ top: 30, bottom: 60 }), { width: 1440, height: 166 })
    expect(pos.top).toBe('66px')
    // maxHeight is what actually keeps it on screen in that case.
    expect(pos.maxHeight).toBe('92px') // 166 - 66 - 8
  })

  it('clamps a flip-above to the top padding instead of running off the page', () => {
    // Gear high on a short page: flipping would compute a negative top.
    const pos = popoverPosition(gear({ top: 120, bottom: 150 }), { width: 1440, height: 200 })
    expect(pos.top).toBe(`${VIEWPORT_PADDING}px`)
    expect(pos.maxHeight).toBe(`${200 - VIEWPORT_PADDING * 2}px`)
  })

  it('clamps the right edge into the viewport when the gear sits past it', () => {
    // A gear whose right edge is beyond the viewport (a horizontally
    // scrolled band) would otherwise push the popover off-screen.
    const pos = popoverPosition(gear({ right: 1600 }), VIEWPORT)
    expect(pos.left).toBe(`${1440 - POPOVER_WIDTH - VIEWPORT_PADDING}px`)
  })

  it('clamps the left edge to the padding on a viewport narrower than the popover', () => {
    const pos = popoverPosition(gear({ right: 180 }), { width: 260, height: 900 })
    expect(pos.left).toBe(`${VIEWPORT_PADDING}px`)
  })

  it('treats exactly-enough room below as enough (no flip at the boundary)', () => {
    // A gear low enough that there is more room above than below, so the only
    // thing deciding the flip is whether the popover fits under it.
    const low = gear({ top: 600, bottom: 624 })
    // bottom + 6 + 380 lands exactly on the viewport foot: it fits, stay below.
    const height = 624 + 6 + POPOVER_HEIGHT_ESTIMATE
    expect(popoverPosition(low, { width: 1440, height }).top).toBe('630px')
    // One pixel shorter and it no longer fits, so it flips above.
    expect(popoverPosition(low, { width: 1440, height: height - 1 }).top).toBe('214px')
  })
})
