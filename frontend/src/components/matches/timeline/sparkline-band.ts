// Band math for the Campaign Log sparkline: which cell indices the visible
// selection band covers. Pure and geometry-free (index space, not pixels), so
// it unit-tests without a laid-out SVG — the same seam trend-options.ts gives
// TrendChart.
//
// The band is the "current value" readout beside the brush's "edit"
// affordance, and it has to agree with the calendar heatmap sitting next to
// it: both vizzes answer "what is the active range" from the same inputs.

/** The slice of a heatmap cell the band math reads. */
export interface BandCell {
  date: string
}

/** An inclusive index span, or [null, null] when no band should be drawn. */
export type BandSpan = [number | null, number | null]

const NO_BAND: BandSpan = [null, null]

/**
 * Clamp a `[from, to]` day span (YYYY-MM-DD) to in-grid cell indices: the
 * first cell on/after `from` through the last cell on/before `to`.
 *
 * A season can start before the window opens or end after it closes, so the
 * span is clamped rather than matched. Returns [null, null] when the span
 * doesn't overlap the window at all.
 */
export function clampSpanToCells(cells: readonly BandCell[], from: string, to: string): BandSpan {
  const lo = cells.findIndex((c) => c.date >= from)
  if (lo < 0) return NO_BAND
  let hi: number | null = null
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i]!.date <= to) { hi = i; break }
  }
  if (hi === null || hi < lo) return NO_BAND
  return [lo, hi]
}

export interface BandInput {
  cells: readonly BandCell[]
  /** In-flight drag endpoints in cell-index space, or null when not dragging. */
  drag: readonly [number, number] | null
  /** Applied filter bounds — datetime-local strings, '' when unset. */
  filterFrom: string
  filterTo: string
  /** Picked-season day span (YYYY-MM-DD), '' when no season is picked. */
  seasonFrom: string
  seasonTo: string
}

function indexOfDay(cells: readonly BandCell[], day: string): number | null {
  const i = cells.findIndex((c) => c.date === day)
  return i < 0 ? null : i
}

/**
 * The band's endpoints, in precedence order: the in-flight drag, then the
 * applied filter range, then the picked season clamped to the window.
 *
 * A manual range outranks the season even when only ONE bound is set — the
 * calendar heatmap drops its season overlay as soon as either bound appears,
 * and the two vizzes must give the same answer to "what is the active range".
 */
export function bandEndpoints(input: BandInput): BandSpan {
  if (input.drag) return [input.drag[0], input.drag[1]]
  if (input.filterFrom && input.filterTo) {
    return [
      indexOfDay(input.cells, input.filterFrom.slice(0, 10)),
      indexOfDay(input.cells, input.filterTo.slice(0, 10)),
    ]
  }
  if (input.filterFrom || input.filterTo) return NO_BAND
  if (input.seasonFrom && input.seasonTo) {
    return clampSpanToCells(input.cells, input.seasonFrom, input.seasonTo)
  }
  return NO_BAND
}
