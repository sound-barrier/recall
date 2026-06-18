// Public type/const contract + pure helpers for the Matches dossier.
// Extracted from useMatchesDossier.ts so the composable holds the
// stateful aggregation and this module holds the shape it produces.

export type LeaverHandling = 'include' | 'exclude-tally' | 'hide'

export interface WinLossDraw {
  w: number
  l: number
  d: number
  total: number
}

export interface BreakdownEntry {
  key: string
  total: number
  // Per-row winrate as an integer percentage. Draws excluded from
  // the denominator (same convention as the headline winrate).
  winrate: number
  // Per-row share of the breakdown's full count, as an integer
  // percentage. With a corpus of three records each on a different
  // map, each map's `share` is 33; sums across a complete breakdown
  // approximate 100 (rounding drift is fine — the bar visualization
  // is the primary consumer). The dossier bar width binds to
  // `share`, not `winrate`, so the visual reads as "how much of
  // your play is on this map" rather than "what's the per-map
  // winrate" — the latter answers a different question and at low
  // counts produces wildly bimodal 0 / 100 bars that don't
  // communicate volume.
  share: number
}

// One modifier's record over the set — drives the Uphill Battle /
// Reversal KPI tiles. `winrate` is null when the modifier never decided
// (e.g. only draws carried it); `total` is every match that carried it.
export interface ModifierRecord {
  total: number
  winrate: number | null
}

// Top-hero breakdown row. Same `key` / `share` / `winrate` contract
// as BreakdownEntry, but `total` is summed play-time minutes (not
// match count), and `timeLabel` is the human-facing render of that
// total ("7h32min" / "32min"). The hero breakdown ranks by time
// played across every heroes_played[] entry — a 100% Lúcio one-trick
// across five 12-minute matches reads higher than three 4-minute
// secondary picks even though both are "three matches as Lúcio."
export interface HeroBreakdownEntry {
  key: string
  totalMinutes: number
  share: number
  winrate: number
  timeLabel: string
}

// Average per-10-min K/D/A rates across the tally-eligible records.
// Each match's `performance.{eliminations,deaths,assists}.avg_per_10min`
// is already game-length-normalized; we straight-average across
// matches so each match counts equally regardless of duration.
// `label` is the pre-formatted "K.KK / D.DD / A.AA" render — two
// decimal places, rounded — for direct binding in the KPI tile.
// recordsTotal exposes the data-coverage fraction so the caller
// can disclose "averaged over N of M" when not every record
// contributed performance data.
export interface AverageKDA {
  eliminations: number
  deaths: number
  assists: number
  label: string
  qualifyingMatches: number
  recordsTotal: number
}

// Total match time across the narrow. `minutes` carries the raw
// fractional total (so callers can compute averages without re-
// parsing the label) and `label` is the formatPlayMinutes render
// ("7h32min" / "—"). recordsWithTime / recordsTotal expose the
// data-coverage fraction — the KPI tile can disclose "2 of 4
// matches" when not every record contributed a game_length.
export interface TotalTimePlayed {
  minutes: number
  label: string
  recordsWithTime: number
  recordsTotal: number
}

// Most-played-hero annotation for the dossier KPI tile. `key` is
// the time-ranked top hero (topHeroes[0]); `winrate` is the
// integer percentage over matches where THAT hero's percent_played
// cleared MOST_PLAYED_HERO_THRESHOLD. Sub-threshold appearances
// don't count toward the denom — a one-trick whose flex picks
// land at 5% shouldn't drag their main hero's read down because of
// matches they weren't really playing that hero in. Null winrate
// means no qualifying matches existed (or no decisive ones).
export interface MostPlayedHero {
  key: string
  winrate: number | null
  qualifyingMatches: number
}

// Review-coverage summary for the dossier KPI tile. `reviewed`
// counts records carrying a `reviewed_by` ('self' or 'coach');
// `total` is the narrow's full record count; `percent` is the
// integer share rounded for display. The dossier sub-line surfaces
// the percentage so the user reads "23 / 47 — 49%" at a glance.
export interface ReviewedCount {
  reviewed: number
  total: number
  percent: number
}

// Recency window for the "Days since last review" widget. `days`
// is the floored count of 24-hour periods between the most-recent
// `reviewed_at` in the narrow and "now". Null when no record in
// the narrow has been reviewed — the tile then renders an em-dash.
// `lastReviewedAt` is the raw ISO string so the tile can title-tip
// the precise timestamp for hover.
export interface DaysSinceLastReview {
  days: number | null
  lastReviewedAt: string | null
}

// Role-share breakdown row. `key` is one of the three canonical
// Overwatch roles; `total` is the count of matches the role appeared
// in; `share` is `total / total_matches * 100` (NOT normalized over
// the row sum) so open-queue matches that hit multiple roles
// contribute to multiple bars — the row's percentages will sum to
// >100% when overlap exists. `winrate` is the per-role wins / decisive
// over matches that included the role.
//
// Distinct from `BreakdownEntry` because `share` has different
// semantics (entity-share vs row-share) and the keys are a closed
// 3-element enum rather than open strings.
export type Role = 'tank' | 'dps' | 'support'
export interface RoleBreakdownEntry {
  key: Role
  total: number
  share: number
  winrate: number
}

// W/L/D over the matches that came in AFTER the most-recent
// `reviewed_at` in the narrow. Same tallyRecords gate as the
// headline `wld` so leaver-handling stays consistent; the anchor
// is the same `lastReviewedAt` the days-since widget already
// finds. `referenceAt` echoes the anchor (and reads null when no
// review has happened yet) so the caller can title-tip the exact
// timestamp without re-computing it.
export interface WLDSinceLastReview {
  w: number
  l: number
  d: number
  total: number
  referenceAt: string | null
}

// Default minimum heroes_played[].percent_played for a record to
// count toward the most-played-hero win-rate denom. Picked at 20%
// so a brief experimental swap doesn't drag the rate around, but
// the canonical "split your time across two heroes" case (e.g.
// 60/40 ana/baptiste) still attributes win/loss to both. The
// dossier query helpers accept this as an explicit `minPercentPlayed`
// option so widgets can override via useWidgetConfig.
export const DEFAULT_MOST_PLAYED_HERO_THRESHOLD = 20

// Maps a hero name to its canonical role. Production passes
// `useOWData().heroRole`; tests pass a small mock. Returning
// undefined / '' / a non-canonical-role value drops the hero from
// the role-set for that match.
export type HeroRoleResolver = (hero: string) => string | undefined

export function isCanonRole(s: string | undefined | null): s is Role {
  return s === 'tank' || s === 'dps' || s === 'support'
}

// Trailing-window cutoff as a YYYY-MM-DD string: the local calendar
// date `months` before today. Compared lexicographically against a
// record's data.date (also YYYY-MM-DD) to scope a view to recent play
// — the Map × Role band's 1M/3M/6M/12M toggle.
export function monthsAgoISO(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Current-streak summary for the dossier KPI. `result` carries the
// streak's class so the widget can colour it; `sinceDate` is the
// `data.date` of the FIRST match in the streak (used in the tile's
// subtitle). Null result + zero count when the narrow has no
// decisive matches.
export interface CurrentStreak {
  count: number
  result: 'victory' | 'defeat' | 'draw' | null
  sinceDate: string | null
}

// Best-winrate-hero summary for the dossier KPI. Mirrors
// MostPlayedHero shape but ranks by winrate (gated to ≥ 3 qualifying
// decisive matches). Null when no hero qualifies.
export interface BestWinrateHero {
  key: string
  winrate: number
  qualifyingMatches: number
}

// Fixed-bucket distribution row for the time-of-day + day-of-week
// breakdowns. Labels are pre-formatted display strings.
export interface BucketEntry {
  label: string
  count: number
  share: number
}

// Default minimum qualifying matches for the best-winrate-hero KPI
// to surface a hero — prevents a 1W / 0L spike on a one-off pick
// from dominating the read. Widgets override via useWidgetConfig.
export const DEFAULT_BEST_WINRATE_HERO_MIN_MATCHES = 3

// Generates time-of-day labels for a given bucket count (6 → 4-hour
// windows, 12 → 2-hour, 24 → 1-hour). Endpoints zero-padded to 2
// digits so the labels read uniformly in the breakdown row. Module-
// local; the dossier's timeOfDayBuckets query helper is the only
// caller.
export function makeTimeOfDayLabels(bucketCount: number): string[] {
  const hoursPerBucket = 24 / bucketCount
  const out: string[] = []
  for (let i = 0; i < bucketCount; i++) {
    const start = i * hoursPerBucket
    const end = (i + 1) * hoursPerBucket
    out.push(`${String(start).padStart(2, '0')}–${String(end).padStart(2, '0')}`)
  }
  return out
}

// Day-of-week labels in Sun-Sat (JS Date.getDay) order. Rotation
// against useWeekStart happens at consumption time so the dossier
// row matches the user's calendar setting.
export const DAY_OF_WEEK_LABELS = [
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
] as const

// Default recent-N-matches widget cap. 5 fits the dossier breakdown
// row's width comfortably. Widgets override via useWidgetConfig.
export const DEFAULT_RECENT_RESULTS_COUNT = 5

// Default top-maps / top-game-modes limit. Five rows is the breakdown
// grid's natural fit for short-label entries (map names, game modes).
export const DEFAULT_TOP_BY_COUNT_LIMIT = 5

// Default top-heroes-by-minutes limit. Three rows because the
// time-based row carries a longer label ("7h32min") than the
// short-label breakdowns above.
export const DEFAULT_TOP_HEROES_LIMIT = 3

// Default time-of-day bucket count. Six 4-hour windows matches the
// historical layout. Widgets opt into 12 (2-hour) or 24 (1-hour)
// via useWidgetConfig.
export const DEFAULT_TIME_OF_DAY_BUCKET_COUNT = 6 as const

// One cell of the Map × Role performance band: the W/L/D tally for a
// (specific map, role) pair across the narrowed set. `winrate`
// excludes draws from the denominator (same convention as the
// headline winrate). Only populated pairs are emitted — the band
// supplies the full map roster and renders absent pairs as empty cells.
export interface MapRoleCell {
  map: string
  role: 'tank' | 'dps' | 'support'
  wins: number
  losses: number
  draws: number
  total: number
  winrate: number
}
