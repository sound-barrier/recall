// Pure mask geometry extracted from TourSpotlight.vue. The SFC owns the
// live measurements (getBoundingClientRect + ResizeObserver); everything
// that DECIDES a coordinate lives here so the cutout, the viewfinder
// bracket length, and the four bracket paths are unit-testable without
// mounting an SVG-heavy component into happy-dom's zeroed layout engine.

import type { Rect } from '@/components/shared/tour-callout-helpers'

/** The subset of a DOMRect the mask math reads. */
export interface SpotlightBounds {
  left: number
  top: number
  width: number
  height: number
}

/** A single viewfinder corner bracket: which corner, and its SVG path. */
export interface BracketPath {
  corner: 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
  d: string
}

// A cutout of zero size collapses the mask hole entirely, which is how the
// Welcome / Done steps dim the whole viewport.
const COLLAPSED: Rect = { x: 0, y: 0, w: 0, h: 0 }

/**
 * Viewport-relative cutout rect for a spotlighted element: the target's
 * bounds grown by `padding` on every side, clamped so the hole never
 * starts off the top/left of the viewport (a negative x/y would push the
 * rounded corner out of view and read as a straight edge). A null target
 * collapses the cutout.
 */
export function spotlightRectFor(bounds: SpotlightBounds | null, padding: number): Rect {
  if (!bounds) return { ...COLLAPSED }
  return {
    x: Math.max(0, bounds.left - padding),
    y: Math.max(0, bounds.top - padding),
    w: bounds.width + padding * 2,
    h: bounds.height + padding * 2,
  }
}

/**
 * Length of each viewfinder corner bracket — a fraction of the cutout's
 * shorter side, floored and capped so a tiny target still gets a legible
 * bracket and a full-screen one doesn't get an L that reads as a border.
 * A collapsed cutout has no brackets.
 */
export function bracketLength(rect: Rect): number {
  if (rect.w === 0 || rect.h === 0) return 0
  return Math.max(10, Math.min(20, Math.min(rect.w, rect.h) * 0.18))
}

/**
 * The four L-shaped corner brackets that ring the cutout, each drawn
 * from one arm's end, through the corner, to the other arm's end.
 */
export function cornerBracketPaths(rect: Rect, len: number): BracketPath[] {
  const { x, y, w, h } = rect
  const right = x + w
  const bottom = y + h
  return [
    { corner: 'top-left',     d: `M ${x} ${y + len} L ${x} ${y} L ${x + len} ${y}` },
    { corner: 'top-right',    d: `M ${right - len} ${y} L ${right} ${y} L ${right} ${y + len}` },
    { corner: 'bottom-right', d: `M ${right} ${bottom - len} L ${right} ${bottom} L ${right - len} ${bottom}` },
    { corner: 'bottom-left',  d: `M ${x + len} ${bottom} L ${x} ${bottom} L ${x} ${bottom - len}` },
  ]
}
