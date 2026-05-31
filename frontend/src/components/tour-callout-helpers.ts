// Pure geometry helpers extracted from TourCallout.vue so the
// placement math is testable in isolation without mounting an SVG-
// heavy SFC into happy-dom. The component composes these with
// getBoundingClientRect() + window.innerWidth/Height.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// Axis-aligned bounding-box intersection. Returns true when `a` and
// `b` share any area; touching edges (a.x + a.w === b.x) count as
// non-overlapping so two side-by-side rects don't false-trigger.
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}
