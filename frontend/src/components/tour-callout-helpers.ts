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

// True when two rects match on every axis within `eps` pixels. The
// tour callout polls a target's rect across animation frames and uses
// this to decide the target has stopped moving (its enter transition
// has settled), so placement measures the final rect instead of a
// mid-slide-in frame. `eps` absorbs steady-state subpixel jitter so a
// settled-but-jittering rect still reads as stable.
export function rectsEqual(a: Rect, b: Rect, eps = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.w - b.w) <= eps &&
    Math.abs(a.h - b.h) <= eps
  )
}
