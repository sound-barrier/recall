// Pure colour helpers for the performance heatmaps. Kept in its own
// module (not match-helpers.ts) because match-helpers is pulled into
// the INITIAL bundle by App.vue's eager `screenshotURL` import — this
// file is imported only by the lazy Matches-view chunk, so the heatmap
// colour math stays out of the initial budget.

// The judgment bands: on the ladder anything above 51% is a climb (a
// slower climb is still a climb) and anything below 48.5% is a slide —
// only the dead zone between stays neutral. The bands judge the RAW
// rate; the only volume gate is the 15-decisive floor below which a
// cell stays neutral outright (a 5-0 heater is a nice evening, not
// evidence). Confidence beyond the floor is carried by
// heatmapCellOpacity — a 16-game green renders fainter than a 60-game
// green — NOT by withholding the colour.
//
// History: an earlier version also shrank the rate toward 50% with a
// 90-imaginary-game prior before comparing. That made green cost
// 51% + 90/decisive points of observed win rate — ~57% at the 25–35
// games a real hero pool accumulates per hero — so players watched
// themselves climb on 52% heroes that stubbornly rendered grey. The
// prior double-counted skepticism the opacity ramp already encodes,
// and was removed deliberately; don't reintroduce it.
const JUDGMENT_WIN_PCT = 51
const JUDGMENT_LOSS_PCT = 48.5
const JUDGMENT_MIN_DECISIVE = 15

// Discrete win / mid / loss / draw / empty class for a performance-heatmap
// cell. Shared by every surface that passes JUDGMENT on a win rate — the
// Hero × Game-Mode root cell, the drilled map-tile, the Map × Role band,
// the Hero Pool bars, and the Elo hero-picker fill. (The calendar records
// what happened rather than judging it and keeps its continuous hue.)
// The param type asks only for what the judgment actually reads — notably
// NOT the display-rounded `winrate` field, so a caller can't accidentally
// feed a rounded rate across a band edge.
export function heatmapCellClass(c: { total: number; wins: number; losses: number }): string {
  if (c.total === 0) return 'cell-empty'
  const decisive = c.wins + c.losses
  if (decisive === 0) return 'cell-draw'
  if (decisive < JUDGMENT_MIN_DECISIVE) return 'cell-mid'

  // The exact fraction, not the pre-rounded `winrate` field — a 50.6%
  // cell must not round its way across a band edge.
  const rate = (c.wins / decisive) * 100
  if (rate > JUDGMENT_WIN_PCT) return 'cell-win'
  if (rate < JUDGMENT_LOSS_PCT) return 'cell-loss'
  return 'cell-mid'
}

// Volume-proportional opacity for a heatmap cell — faint at one game,
// solid by ~10. undefined for an empty cell so the CSS default applies.
export function heatmapCellOpacity(c: { total: number }): string | undefined {
  if (c.total === 0) return undefined
  return String(Math.min(0.45 + (c.total / 10) * 0.55, 1))
}

