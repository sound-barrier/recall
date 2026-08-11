// Pure judgment helpers for the performance heatmaps — the band each
// win rate falls in, the class that paints it, and the ONE vocabulary
// that speaks it. Kept in its own
// module (not match-helpers.ts) because match-helpers is pulled into
// the INITIAL bundle by App.vue's eager `screenshotURL` import — this
// file is imported only by the lazy Matches-view chunk, so the heatmap
// color math stays out of the initial budget.

// The judgment bands: on the ladder anything above 51% is a climb (a
// slower climb is still a climb) and anything below 48.5% is a slide —
// only the dead zone between stays neutral. The bands judge the RAW
// rate; the only volume gate is the 15-decisive floor below which a
// cell stays neutral outright (a 5-0 heater is a nice evening, not
// evidence). Confidence beyond the floor is carried by
// heatmapCellOpacity — a 16-game green renders fainter than a 60-game
// green — NOT by withholding the color.
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

// The band a surface's tint is painted FROM. `even` and `unproven` share
// one grey class on purpose — the eye can't tell "genuinely level" from
// "not enough games yet", but the accessible name must, so the spoken
// vocabulary keeps them apart (WCAG 1.4.1: a verdict carried by color
// alone is no verdict at all for a screen-reader or colorblind player).
type JudgmentBand = 'win' | 'even' | 'loss' | 'unproven' | 'draw' | 'empty'

// THE shared judgment vocabulary. One lookup, keyed by the band, read by
// every tinted surface — the two heatmaps, the drilled map tiles, the
// distribution bars, the streak / form / net-rank KPIs, the result pills
// — so "winning" means the same thing wherever it is spoken and no
// template hand-writes a verdict of its own. Wording follows the band
// function's own reading of the ladder: past 51% is a climb, under 48.5%
// a slide, the dead zone between them level, and under the evidence
// floor no verdict at all.
export const JUDGMENT_LABEL: Record<JudgmentBand, string> = {
  win:      'winning',
  even:     'even',
  loss:     'losing',
  unproven: 'too few games to judge',
  draw:     'drawn',
  empty:    'no matches',
}

// The tint each band paints. Keyed by the same discriminant as the
// vocabulary, so a new band cannot gain a color without gaining a word.
const BAND_CLASS: Record<JudgmentBand, string> = {
  win:      'cell-win',
  even:     'cell-mid',
  loss:     'cell-loss',
  unproven: 'cell-mid',
  draw:     'cell-draw',
  empty:    'cell-empty',
}

// The judgment itself: which band a performance-heatmap cell falls in.
// Shared by every surface that passes JUDGMENT on a win rate — the
// Hero × Game-Mode root cell, the drilled map-tile, the Map × Role band,
// the Hero Pool bars, and the Elo hero-picker fill. (The calendar records
// what happened rather than judging it and keeps its continuous hue.)
// The param type asks only for what the judgment actually reads — notably
// NOT the display-rounded `winrate` field, so a caller can't accidentally
// feed a rounded rate across a band edge.
function heatmapCellBand(c: { total: number; wins: number; losses: number }): JudgmentBand {
  if (c.total === 0) return 'empty'
  const decisive = c.wins + c.losses
  if (decisive === 0) return 'draw'
  if (decisive < JUDGMENT_MIN_DECISIVE) return 'unproven'

  // The exact fraction, not the pre-rounded `winrate` field — a 50.6%
  // cell must not round its way across a band edge.
  const rate = (c.wins / decisive) * 100
  if (rate > JUDGMENT_WIN_PCT) return 'win'
  if (rate < JUDGMENT_LOSS_PCT) return 'loss'
  return 'even'
}

// Discrete win / mid / loss / draw / empty class for a heatmap cell.
export function heatmapCellClass(c: { total: number; wins: number; losses: number }): string {
  return BAND_CLASS[heatmapCellBand(c)]
}

// What that same cell's tint SAYS — appended to the cell's accessible
// name so the band survives without color.
export function heatmapCellJudgment(c: { total: number; wins: number; losses: number }): string {
  return JUDGMENT_LABEL[heatmapCellBand(c)]
}

// Judgment class for a distribution bucket (time-of-day / day-of-week /
// session-depth rows) — adapts BucketEntry-shaped tallies to the shared
// cell judgment so the widget bars and the bands can never disagree
// about what a 53% means.
export function bucketCellClass(b: { count: number; wins: number; decisive: number }): string {
  return heatmapCellClass({ total: b.count, wins: b.wins, losses: b.decisive - b.wins })
}

// The spoken form of that bucket's tint.
export function bucketCellJudgment(b: { count: number; wins: number; decisive: number }): string {
  return heatmapCellJudgment({ total: b.count, wins: b.wins, losses: b.decisive - b.wins })
}

// Match results tint from the same win / loss / draw palette (the streak
// KPI, the recent-result pills), so they speak the same three words. A
// result is never "unproven" — it happened. Callers render nothing at
// all when there is no result, so no absence case is modeled here.
const RESULT_BAND: Record<'victory' | 'defeat' | 'draw', JudgmentBand> = {
  victory: 'win',
  defeat:  'loss',
  draw:    'draw',
}

export function resultJudgment(result: 'victory' | 'defeat' | 'draw'): string {
  return JUDGMENT_LABEL[RESULT_BAND[result]]
}

// Signed movement (form delta vs baseline, weekly net rank) tints from
// the same palette: above the line is winning, below it losing, zero
// even. No evidence floor applies — the number is the whole claim.
export function signJudgment(delta: number): string {
  if (delta > 0) return JUDGMENT_LABEL.win
  if (delta < 0) return JUDGMENT_LABEL.loss
  return JUDGMENT_LABEL.even
}

// Volume-proportional opacity for a heatmap cell — faint at one game,
// solid by ~10. undefined for an empty cell so the CSS default applies.
export function heatmapCellOpacity(c: { total: number }): string | undefined {
  if (c.total === 0) return undefined
  return String(Math.min(0.45 + (c.total / 10) * 0.55, 1))
}

