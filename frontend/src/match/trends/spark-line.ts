// Pure sparkline geometry. Values are rolling win-rate percentages (0–100);
// the view binds the constants into the SVG viewBox and the midline.
//
// Lives in @/match rather than beside one of its callers because it is pure
// geometry two unrelated surfaces need — the Form verdict card's facing pair
// and the per-hero trend lines on the dashboard — and a helper that belongs to
// whichever view imported it first is how the second one ends up with its own
// copy.

export const SPARK_W = 220
export const SPARK_H = 56
const SPARK_PAD = 6

/** The 50% win-rate midline's y coordinate. */
export const midY = SPARK_PAD + (SPARK_H - 2 * SPARK_PAD) / 2

/** The box a sparkline is drawn in. Defaults to the Form card's pair. */
export interface SparkBox {
  w: number
  h: number
}

const DEFAULT_BOX: SparkBox = { w: SPARK_W, h: SPARK_H }

/**
 * SVG polyline points for a rolling win-rate series (flat line for n=1).
 *
 * The box is a parameter because the same line is drawn at two very different
 * sizes: a facing pair on the verdict card, and a strip beside a hero's name.
 * Rescaling by CSS instead would stretch the stroke with it.
 */
export function sparkPoints(values: number[], box: SparkBox = DEFAULT_BOX): string {
  if (values.length === 0) return ''
  const y = (v: number) => SPARK_PAD + ((100 - v) / 100) * (box.h - 2 * SPARK_PAD)
  if (values.length === 1) {
    return `0,${y(values[0]!).toFixed(1)} ${box.w},${y(values[0]!).toFixed(1)}`
  }
  const step = box.w / (values.length - 1)
  return values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
}

/**
 * A text equivalent of the line's shape (WCAG 1.1.1) — the label carries
 * the data the chart shows, not just its name.
 */
export function sparkAria(values: number[], which: string): string {
  if (values.length === 0) return ''
  const first = values[0]!
  const last = values[values.length - 1]!
  return `Rolling win rate ${which}: ${first}% to ${last}% across ${values.length} decisive games`
}
