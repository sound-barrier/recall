// Pure sparkline geometry for the Form verdict card's facing pair.
// Values are rolling win-rate percentages (0–100); the view binds the
// constants into the SVG viewBox and the midline.

export const SPARK_W = 220
export const SPARK_H = 56
const SPARK_PAD = 6

/** The 50% win-rate midline's y coordinate. */
export const midY = SPARK_PAD + (SPARK_H - 2 * SPARK_PAD) / 2

/** SVG polyline points for a rolling win-rate series (flat line for n=1). */
export function sparkPoints(values: number[]): string {
  if (values.length === 0) return ''
  if (values.length === 1) {
    const y = SPARK_PAD + ((100 - values[0]!) / 100) * (SPARK_H - 2 * SPARK_PAD)
    return `0,${y.toFixed(1)} ${SPARK_W},${y.toFixed(1)}`
  }
  const step = SPARK_W / (values.length - 1)
  return values
    .map((v, i) => `${(i * step).toFixed(1)},${(SPARK_PAD + ((100 - v) / 100) * (SPARK_H - 2 * SPARK_PAD)).toFixed(1)}`)
    .join(' ')
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
