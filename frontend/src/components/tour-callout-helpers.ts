// Pure geometry helpers extracted from TourCallout.vue so the
// placement math is testable in isolation without mounting an SVG-
// heavy SFC into happy-dom. The component composes these with
// getBoundingClientRect() + window.innerWidth/Height.

import type { CalloutPlacement } from '../composables/useOnboardingTour'

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

// Fixed-pixel layout knobs the placement solver needs. The SFC owns the
// values (callout width, viewport safety margin, target↔callout gap) and
// passes them in so this stays pure + unit-testable.
export interface CalloutLayout {
  calloutW: number
  safety: number
  gap: number
}

// Pure placement solver for the tour callout. Given the (already-measured)
// target rect, the callout's height, the viewport, and the step's preferred
// side, returns clamped left/top + the resolved placement. No DOM access —
// the SFC supplies target / height / viewport. Honour an explicit side when
// it physically fits; otherwise auto-search bottom→right→left→top rejecting
// any side that would overlap the target; otherwise drop into the viewport
// corner farthest from the target's centre.
export function computeCalloutPosition(
  target: Rect | null,
  calloutH: number,
  vw: number,
  vh: number,
  preferred: CalloutPlacement,
  layout: CalloutLayout,
): { left: number; top: number; placement: CalloutPlacement } {
  const { calloutW, safety, gap } = layout
  const h = calloutH

  // No target → centre.
  if (!target) {
    return {
      left: Math.max(safety, (vw - calloutW) / 2),
      top:  Math.max(safety, (vh - h) / 2),
      placement: 'auto',
    }
  }
  const tt = target

  // Produce coords for a given side, clamped into the viewport. When
  // `checkOverlap` is true (auto-placement path), also reject sides where
  // the clamped rect would still cover the target. When false (explicit
  // step-level placement), honor the requested side as long as it fits.
  function place(
    side: CalloutPlacement,
    checkOverlap: boolean,
  ): { left: number; top: number } | null {
    let left: number
    let top: number
    if (side === 'bottom') {
      top = tt.y + tt.h + gap
      if (top + h + safety > vh) return null
      left = Math.max(safety, Math.min(vw - calloutW - safety, tt.x + tt.w / 2 - calloutW / 2))
    } else if (side === 'top') {
      top = tt.y - gap - h
      if (top < safety) return null
      left = Math.max(safety, Math.min(vw - calloutW - safety, tt.x + tt.w / 2 - calloutW / 2))
    } else if (side === 'right') {
      left = tt.x + tt.w + gap
      if (left + calloutW + safety > vw) return null
      top = Math.max(safety, Math.min(vh - h - safety, tt.y + tt.h / 2 - h / 2))
    } else if (side === 'left') {
      left = tt.x - gap - calloutW
      if (left < safety) return null
      top = Math.max(safety, Math.min(vh - h - safety, tt.y + tt.h / 2 - h / 2))
    } else {
      return null
    }
    if (checkOverlap) {
      const calloutRect = { x: left, y: top, w: calloutW, h }
      const targetWithMargin = { x: tt.x - 4, y: tt.y - 4, w: tt.w + 8, h: tt.h + 8 }
      if (rectsOverlap(calloutRect, targetWithMargin)) return null
    }
    return { left, top }
  }

  if (preferred !== 'auto') {
    // Explicit placement requested — try it first WITHOUT the overlap
    // check so the step author's choice wins when it physically fits.
    const explicit = place(preferred, false)
    if (explicit) return { ...explicit, placement: preferred }
  }

  // Auto-placement search — try every side with overlap rejection so an
  // unspecified step never lands on top of its target.
  const trySides: CalloutPlacement[] = ['bottom', 'right', 'left', 'top']
  for (const side of trySides) {
    const out = place(side, true)
    if (out) return { ...out, placement: side }
  }

  // No side has room without overlap — fall back to the viewport corner
  // farthest from the target's centre so the body stays readable.
  const targetCx = tt.x + tt.w / 2
  const targetCy = tt.y + tt.h / 2
  const left = targetCx < vw / 2 ? vw - calloutW - safety : safety
  const top  = targetCy < vh / 2 ? vh - h - safety        : safety
  return { left, top, placement: 'auto' }
}
