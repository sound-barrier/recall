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

// Discrete win / mid / loss / draw / empty class for a performance-heatmap
// cell, by win-rate band. Shared by the Hero × Game-Mode root heatmap-cell
// and the drilled map-tile, which colour the same way.
export function heatmapCellClass(c: { total: number; winrate: number; wins: number; losses: number }): string {
  if (c.total === 0)           return 'cell-empty'
  if (c.wins + c.losses === 0) return 'cell-draw'
  if (c.winrate >= 60)         return 'cell-win'
  if (c.winrate <= 40)         return 'cell-loss'
  return 'cell-mid'
}

// Volume-proportional opacity for a heatmap cell — faint at one game,
// solid by ~10. undefined for an empty cell so the CSS default applies.
export function heatmapCellOpacity(c: { total: number }): string | undefined {
  if (c.total === 0) return undefined
  return String(Math.min(0.45 + (c.total / 10) * 0.55, 1))
}
