import { describe, expect, it } from 'vitest'

import {
  POPOVER_HEIGHT_ESTIMATE,
  VIEWPORT_PADDING,
  sortGroupPopoverPosition,
  type AnchorRect,
} from '@/components/matches/list/sort-group-popover-position'

// The Sort/Group trigger somewhere in the leaves head; `left` is what the
// popover left-aligns to, `top`/`bottom` decide below-vs-above.
function trigger(over: Partial<AnchorRect> = {}): AnchorRect {
  return { top: 200, bottom: 224, left: 320, ...over }
}

const VIEWPORT_HEIGHT = 900

describe('sortGroupPopoverPosition', () => {
  it('stays hidden until the trigger has reported its rect', () => {
    expect(sortGroupPopoverPosition(null, VIEWPORT_HEIGHT)).toEqual({ display: 'none' })
  })

  it('pins under the trigger and left-aligns to it when there is room below', () => {
    // 900 - (224 + 6) = 670 of room below, clear of the 240 estimate.
    expect(sortGroupPopoverPosition(trigger(), VIEWPORT_HEIGHT)).toEqual({
      top: '230px',
      left: '320px',
      maxHeight: '662px', // 900 - 230 - 8
      overflowY: 'auto',
    })
  })

  it('flips above the trigger once the space below cannot hold it', () => {
    // A trigger near the foot: 20px below it, plenty above.
    const pos = sortGroupPopoverPosition(trigger({ top: 800, bottom: 874 }), VIEWPORT_HEIGHT)
    expect(pos.top).toBe('554px') // 800 - 6 - 240
  })

  it('treats exactly-enough room below as enough — the flip boundary', () => {
    const low = trigger({ top: 600, bottom: 624 })
    const height = 624 + 6 + POPOVER_HEIGHT_ESTIMATE // fits by a hair
    expect(sortGroupPopoverPosition(low, height).top).toBe('630px')
    // One pixel shorter and it no longer fits, so it flips above.
    expect(sortGroupPopoverPosition(low, height - 1).top).toBe('354px')
  })

  it('clamps a flip-above to the top padding instead of running off the page', () => {
    // A trigger high on a short page: flipping would compute a negative top.
    const pos = sortGroupPopoverPosition(trigger({ top: 120, bottom: 150 }), 200)
    expect(pos.top).toBe(`${VIEWPORT_PADDING}px`)
    // maxHeight is what keeps it on screen once the top is clamped.
    expect(pos.maxHeight).toBe(`${200 - VIEWPORT_PADDING * 2}px`)
  })

  it('clamps the left edge to the padding for a trigger scrolled past it', () => {
    expect(sortGroupPopoverPosition(trigger({ left: -40 }), VIEWPORT_HEIGHT).left)
      .toBe(`${VIEWPORT_PADDING}px`)
  })
})
