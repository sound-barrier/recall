// Bridge between the CSS palette and the charting layer.
//
// ECharts draws to a canvas, so it can't consume `var(--tank)` — it needs a
// concrete color string. Chart modules therefore used to hardcode their
// series hues, which froze every chart to the dark palette: the Trends role
// lines stayed `#5ca8ff` on Day's cream ground while the same role rendered
// as `--tank` (`#1f5491`) everywhere else in the app. Reading the tokens at
// option-build time keeps one source of truth for "what colour is Tank".
//
// Consumers must rebuild their options when the theme changes; TrendChart
// already re-registers its ECharts theme on `watch(themeMode, …)`.

/** Read a CSS custom property off the document root. */
export function cssVar(name: string, fallback = ''): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

// Expand #rgb / #rgba shorthand to the 6/8-digit form. This is the case that
// actually bit: `areaFill()` built its gradient stops by concatenating an
// alpha suffix onto the series colour (`${c}40`), which silently produces the
// invalid `#6df40` for high-contrast's `--tank: #6df`. ECharts renders an
// unparseable colour as transparent, so the area fill just vanished on that
// theme with no error anywhere.
function expandHex(hex: string): string {
  const body = hex.slice(1)
  if (body.length === 3 || body.length === 4) {
    return '#' + [...body].map((ch) => ch + ch).join('')
  }
  return hex
}

/**
 * Normalise any CSS colour notation to a concrete `rgb()` / `rgba()` string.
 *
 * Hex is expanded inline; everything else (named colours, `color-mix()`,
 * `oklch()`, …) goes through the browser's own parser via a probe element, so
 * this keeps working as the palette adopts newer colour syntax. Returns the
 * input unchanged when there is no DOM to probe with.
 */
export function resolveColor(value: string): string {
  const v = value.trim()
  if (!v) return v
  if (v.startsWith('#')) return expandHex(v)
  if (typeof document === 'undefined') return v

  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  probe.style.color = v
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  return computed || v
}

/** Read a palette token and normalise it to a concrete colour string. */
export function themeColor(name: string, fallback = ''): string {
  return resolveColor(cssVar(name, fallback))
}

/**
 * Re-express a colour at the given alpha (0–1).
 *
 * Always emits `rgba(…)` rather than appending hex digits, so it's safe for
 * any input notation and any shorthand length. An alpha applied to a colour
 * that already carries one replaces it.
 */
export function withAlpha(color: string, alpha: number): string {
  const resolved = resolveColor(color)

  if (resolved.startsWith('#')) {
    const body = resolved.slice(1)
    const r = parseInt(body.slice(0, 2), 16)
    const g = parseInt(body.slice(2, 4), 16)
    const b = parseInt(body.slice(4, 6), 16)
    if ([r, g, b].some(Number.isNaN)) return resolved
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  const nums = resolved.match(/-?[\d.]+/g)
  if (!nums || nums.length < 3) return resolved
  const [r, g, b] = nums
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
