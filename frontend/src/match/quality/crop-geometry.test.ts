import { describe, expect, it } from 'vitest'

import { cropLayout } from '@/match/quality/crop-geometry'

// The crop is drawn by sizing and offsetting the WHOLE screenshot inside a box
// that clips it. Every number is a percentage of the box, so the same layout
// holds whatever size the box renders at, whatever size the image file turns
// out to be, and whatever the display's pixel ratio.

const region = { x: 400, y: 300, width: 80, height: 40, image_width: 1920, image_height: 1080 }

describe('cropLayout', () => {
  it('frames the region with a margin of context, in the image\'s own proportions', () => {
    const layout = cropLayout(region, { pad: 10 })

    // 80x40 read rect + 10px on each side = a 100x60 window.
    expect(layout?.aspectRatio).toBeCloseTo(100 / 60)
    expect(layout?.image.widthPct).toBeCloseTo((1920 / 100) * 100)
    expect(layout?.image.heightPct).toBeCloseTo((1080 / 60) * 100)
    expect(layout?.image.leftPct).toBeCloseTo((-390 / 100) * 100)
    expect(layout?.image.topPct).toBeCloseTo((-290 / 60) * 100)
  })

  it('clamps the margin at the image edge rather than drawing past it', () => {
    const layout = cropLayout({ ...region, x: 0, y: 1060, height: 20 }, { pad: 10 })

    // Left edge: no room on the left, so the window starts at 0.
    expect(layout?.image.leftPct).toBeCloseTo(0)
    // Bottom edge: 1050..1080 — 30px tall, not 40.
    expect(layout?.aspectRatio).toBeCloseTo(90 / 30)
    expect(layout?.image.topPct).toBeCloseTo((-1050 / 30) * 100)
  })

  it('magnifies a small read up to the cap, and no wider than the box allows', () => {
    expect(cropLayout(region, { pad: 0, maxScale: 3, maxWidthPx: 1000 })?.widthPx).toBe(240)
    expect(cropLayout(region, { pad: 0, maxScale: 3, maxWidthPx: 200 })?.widthPx).toBe(200)
  })

  it.each([
    ['an empty rect', { ...region, width: 0 }],
    ['an unknown image size', { ...region, image_width: 0 }],
    ['a rect outside the image', { ...region, x: 1920 }],
  ])('has no layout for %s', (_what, bad) => {
    expect(cropLayout(bad)).toBeNull()
  })
})
