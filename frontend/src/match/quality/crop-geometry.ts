import type { FieldRegion } from '@/api-client'

// A crop is the whole screenshot drawn inside a box that clips it, sized and
// offset so the read rectangle (plus a margin of context) fills the box.
//
// Every number is a percentage of the box rather than a pixel count, which is
// what keeps the crop right without knowing three things up front: the size
// the box ends up rendering at, the size of the image file the browser
// receives (the region's image_width/height are the parse's, and a re-encoded
// file may differ), and the display's pixel ratio. `top`/`height` percentages
// of an absolutely positioned child resolve against the box's height, `left`/
// `width` against its width, so the box only has to carry the aspect ratio.

type Region = Pick<FieldRegion, 'x' | 'y' | 'width' | 'height' | 'image_width' | 'image_height'>

export interface CropOptions {
  /** Context kept around the read rectangle, in image pixels. */
  pad?: number
  /** The most a small read is magnified, in CSS pixels per image pixel. */
  maxScale?: number
  /** The widest the box is drawn, in CSS pixels. */
  maxWidthPx?: number
}

export interface CropLayout {
  /** Box width over box height. */
  aspectRatio: number
  /** The width to draw the box at, in CSS pixels (a container may shrink it). */
  widthPx: number
  /** The screenshot's size and offset, each as a percentage of the box. */
  image: { widthPct: number; heightPct: number; leftPct: number; topPct: number }
}

const DEFAULTS = { pad: 8, maxScale: 3, maxWidthPx: 320 }

interface CropWindow { x0: number; y0: number; width: number; height: number }

// The rectangle overlaps the image at all. The margin must not rescue one
// that starts past it: what that would show is context only, none of the
// pixels that were read.
function namesPixels(r: Region): boolean {
  if (r.width <= 0 || r.height <= 0 || r.image_width <= 0 || r.image_height <= 0) return false
  return r.x < r.image_width && r.y < r.image_height && r.x + r.width > 0 && r.y + r.height > 0
}

function paddedWindow(r: Region, pad: number): CropWindow | null {
  if (!namesPixels(r)) return null
  const x0 = Math.max(0, r.x - pad)
  const y0 = Math.max(0, r.y - pad)
  const width = Math.min(r.image_width, r.x + r.width + pad) - x0
  const height = Math.min(r.image_height, r.y + r.height + pad) - y0
  return width > 0 && height > 0 ? { x0, y0, width, height } : null
}

/** The box and image placement that shows `region`; null when it names no pixels. */
export function cropLayout(region: Region, options: CropOptions = {}): CropLayout | null {
  const { pad, maxScale, maxWidthPx } = { ...DEFAULTS, ...options }
  const win = paddedWindow(region, pad)
  if (!win) return null
  return {
    aspectRatio: win.width / win.height,
    widthPx: Math.min(maxWidthPx, win.width * maxScale),
    image: {
      widthPct: (region.image_width / win.width) * 100,
      heightPct: (region.image_height / win.height) * 100,
      leftPct: (-win.x0 / win.width) * 100,
      topPct: (-win.y0 / win.height) * 100,
    },
  }
}
