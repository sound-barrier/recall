// Pure geometry helpers extracted from TourCallout.vue so the
// placement math is testable in isolation without mounting an SVG-
// heavy SFC into happy-dom. The component composes these with
// getBoundingClientRect() + window.innerWidth/Height.

import type { CalloutPlacement } from '@/composables/shared/useOnboardingTour'

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

/** The callout's own placed box, in the same viewport coordinates. */
export interface CalloutBox {
  left: number
  top: number
  w: number
  h: number
}

/** Endpoints of the dashed connector drawn from the callout to the target. */
export interface ConnectorLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

// Connector geometry — a line from the callout's anchor edge to the
// target's center. The anchor edge is picked by DOMINANT AXIS: when the
// target sits mostly sideways of the callout the line leaves the left or
// right edge at the callout's vertical center, otherwise the top or
// bottom edge at its horizontal center. Returns null when there is no
// target (the centered Welcome / Done callouts draw no connector).
export function computeConnector(target: Rect | null, callout: CalloutBox): ConnectorLine | null {
  if (!target) return null
  const targetCx = target.x + target.w / 2
  const targetCy = target.y + target.h / 2
  const cx = callout.left + callout.w / 2
  const cy = callout.top + callout.h / 2
  const dx = targetCx - cx
  const dy = targetCy - cy
  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      x1: dx > 0 ? callout.left + callout.w : callout.left,
      y1: cy,
      x2: targetCx,
      y2: targetCy,
    }
  }
  return {
    x1: cx,
    y1: dy > 0 ? callout.top + callout.h : callout.top,
    x2: targetCx,
    y2: targetCy,
  }
}

// Fixed-pixel layout knobs the placement solver needs. The SFC owns the
// values (callout width, viewport safety margin, target↔callout gap) and
// passes them in so this stays pure + unit-testable.
export interface CalloutLayout {
  calloutW: number
  safety: number
  gap: number
}

// The measured geometry the solver positions within: the callout's
// current height plus the viewport bounds.
export interface CalloutFrame {
  calloutH: number
  vw: number
  vh: number
}

// Pure placement solver for the tour callout. Given the (already-measured)
// target rect, the geometry frame (callout height + viewport), and the
// step's preferred side, returns clamped left/top + the resolved placement.
// No DOM access — the SFC supplies target / frame. Honor an explicit side
// when it physically fits; otherwise auto-search bottom→right→left→top
// rejecting any side that would overlap the target; otherwise drop into the
// viewport corner farthest from the target's center.
export function computeCalloutPosition(
  target: Rect | null,
  frame: CalloutFrame,
  preferred: CalloutPlacement,
  layout: CalloutLayout,
): { left: number; top: number; placement: CalloutPlacement } {
  const { calloutW, safety, gap } = layout
  const { vw, vh, calloutH: h } = frame

  // No target → center.
  if (!target) {
    return {
      left: Math.max(safety, (vw - calloutW) / 2),
      top:  Math.max(safety, (vh - h) / 2),
      placement: 'auto',
    }
  }
  const tt = target

  const clampX = (x: number) => Math.max(safety, Math.min(vw - calloutW - safety, x))
  const clampY = (y: number) => Math.max(safety, Math.min(vh - h - safety, y))

  // Coords for a given side, clamped into the viewport along the cross
  // axis; null when the side doesn't fit at all.
  function sideCoords(side: CalloutPlacement): { left: number; top: number } | null {
    if (side === 'bottom') {
      const top = tt.y + tt.h + gap
      if (top + h + safety > vh) return null
      return { left: clampX(tt.x + tt.w / 2 - calloutW / 2), top }
    }
    if (side === 'top') {
      const top = tt.y - gap - h
      if (top < safety) return null
      return { left: clampX(tt.x + tt.w / 2 - calloutW / 2), top }
    }
    if (side === 'right') {
      const left = tt.x + tt.w + gap
      if (left + calloutW + safety > vw) return null
      return { left, top: clampY(tt.y + tt.h / 2 - h / 2) }
    }
    if (side === 'left') {
      const left = tt.x - gap - calloutW
      if (left < safety) return null
      return { left, top: clampY(tt.y + tt.h / 2 - h / 2) }
    }
    return null
  }

  // Produce coords for a given side. When `checkOverlap` is true
  // (auto-placement path), also reject sides where the clamped rect
  // would still cover the target. When false (explicit step-level
  // placement), honor the requested side as long as it fits.
  function place(
    side: CalloutPlacement,
    checkOverlap: boolean,
  ): { left: number; top: number } | null {
    const coords = sideCoords(side)
    if (!coords) return null
    if (checkOverlap) {
      const calloutRect = { x: coords.left, y: coords.top, w: calloutW, h }
      const targetWithMargin = { x: tt.x - 4, y: tt.y - 4, w: tt.w + 8, h: tt.h + 8 }
      if (rectsOverlap(calloutRect, targetWithMargin)) return null
    }
    return coords
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
  // farthest from the target's center so the body stays readable.
  const targetCx = tt.x + tt.w / 2
  const targetCy = tt.y + tt.h / 2
  const left = targetCx < vw / 2 ? vw - calloutW - safety : safety
  const top  = targetCy < vh / 2 ? vh - h - safety        : safety
  return { left, top, placement: 'auto' }
}
