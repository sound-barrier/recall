// Pure colour helpers for the performance heatmaps. Kept in its own
// module (not match-helpers.ts) because match-helpers is pulled into
// the INITIAL bundle by App.vue's eager `screenshotURL` import — this
// file is imported only by the lazy Matches-view chunk, so the heatmap
// colour math stays out of the initial budget.

// Win-rate hue × volume saturation for a performance-heatmap cell.
// The hue is a green→red blend at `winrate`%; that hue is then blended
// toward the empty tone in proportion to how much volume the cell
// carries relative to the busiest cell — so a one-game cell reads
// faint (low confidence) and the grind-heavy cell reads solid. A
// zero-volume cell returns the empty tone. Mirrors the inline calendar
// formula in MatchHeatmapHeader; used by the Map × Role band.
export function winrateVolumeFill(winrate: number, total: number, maxTotal: number): string {
  if (total <= 0) return 'var(--heatmap-empty)'
  const sat = Math.round(20 + Math.min(1, total / Math.max(maxTotal, 1)) * 80)
  return `color-mix(in srgb, color-mix(in srgb, var(--win) ${winrate}%, var(--loss)) ${sat}%, var(--heatmap-empty))`
}

// The judgment bands: on the ladder anything above 51% is a climb (a
// slower climb is still a climb) and anything below 48.5% is a slide —
// only the dead zone between stays neutral. A band this close to 50%
// must not reward noise, so colour is EARNED: the rate is blended with a
// 90-game coin-flip prior (a skeptic's z-test in disguise) and anything
// under 15 decisive games stays neutral outright. A 5-0 heater is a nice
// evening, not evidence; 52% over a hundred games is a real — longer —
// climb and deserves its green.
const JUDGMENT_WIN_PCT = 51
const JUDGMENT_LOSS_PCT = 48.5
const JUDGMENT_MIN_DECISIVE = 15
const JUDGMENT_PRIOR_GAMES = 90

// Discrete win / mid / loss / draw / empty class for a performance-heatmap
// cell. Shared by every surface that passes JUDGMENT on a win rate — the
// Hero × Game-Mode root cell, the drilled map-tile, the Hero Pool bars,
// and the Elo hero-picker fill. (The calendar records what happened
// rather than judging it and colours via winrateVolumeFill instead.)
export function heatmapCellClass(c: { total: number; winrate: number; wins: number; losses: number }): string {
  if (c.total === 0) return 'cell-empty'
  const decisive = c.wins + c.losses
  if (decisive === 0) return 'cell-draw'
  if (decisive < JUDGMENT_MIN_DECISIVE) return 'cell-mid'
  const shrunk = ((c.wins + JUDGMENT_PRIOR_GAMES / 2) / (decisive + JUDGMENT_PRIOR_GAMES)) * 100
  if (shrunk > JUDGMENT_WIN_PCT) return 'cell-win'
  if (shrunk < JUDGMENT_LOSS_PCT) return 'cell-loss'
  return 'cell-mid'
}

// Volume-proportional opacity for a heatmap cell — faint at one game,
// solid by ~10. undefined for an empty cell so the CSS default applies.
export function heatmapCellOpacity(c: { total: number }): string | undefined {
  if (c.total === 0) return undefined
  return String(Math.min(0.45 + (c.total / 10) * 0.55, 1))
}
