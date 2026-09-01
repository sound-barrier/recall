import type { MatchRecord } from '@/api-client'
import type { Season } from '@/composables/shared/useOWData'
import { escapeHTML } from '@/match/markdown/render-markdown'
import { matchStartUTC, seasonForMatch } from '@/match/match-season-helpers'
import { parseGameLengthMinutes } from '@/match/match-time-helpers'
import { isPlaceableRank } from '@/match/trends/match-trends-helpers'

/**
 * The page a player keeps at the end of a season.
 *
 * Same shape as the coach's sheet, for the same reason: one self-contained
 * HTML file that opens in any browser, offline, forever — no scripts, no
 * images, no links, no fonts, nothing that reaches out. And the same two
 * rules, both enforced by the test beside this file rather than by good
 * intentions: every interpolation goes through `escapeHTML`, and the CSS
 * arrives as a PARAMETER so the builder stays pure and testable.
 *
 * Structured so a rasterizer can be added without a redesign: the numbers are
 * assembled by `toRecapInput` into a flat, serializable shape, and the HTML is
 * one function over it. A PNG renderer is a second function over the same
 * input, not a second aggregation.
 */

/** How many heroes the recap lists. Enough to be a story, short enough to read. */
const TOP_HEROES = 5

interface RecapHero {
  key: string
  games: number
  /** Null when the hero has no decisive games — a draws-only hero has no rate. */
  winratePct: number | null
}

export interface SeasonRecapInput {
  season: string
  games: number
  wins: number
  losses: number
  draws: number
  /** Null when nothing was decided — a season of draws has no win rate. */
  winratePct: number | null
  hoursPlayed: number | null
  /** Where the first and last rank capture of the season put the player. */
  rankStart: string | null
  rankEnd: string | null
  topHeroes: RecapHero[]
  topMaps: RecapHero[]
  /** Distinct calendar days with at least one match. */
  daysPlayed: number
  longestWinStreak: number
}

export function toRecapInput(records: readonly MatchRecord[], season: Season): SeasonRecapInput {
  // Placed by the SAME clock that selected them. seasonForMatch works off the
  // canonical UTC start; ordering by the naive wall clock instead dropped
  // every match the season filter had just accepted on a record with no
  // `date` field — a rank-only capture — so the recap counted zero games in a
  // season it had games in.
  const inSeason = records
    .filter((r) => seasonForMatch(r, [season])?.name === season.name)
    .map((r) => ({ rec: r, t: matchStartUTC(r) }))
    .filter((e): e is { rec: MatchRecord; t: number } => e.t !== null)
    .sort((a, b) => a.t - b.t)

  const tally = { wins: 0, losses: 0, draws: 0 }
  const days = new Set<string>()
  let minutes = 0
  let anyLength = false
  for (const { rec, t } of inSeason) {
    countResult(tally, rec.data?.result)
    // The day comes from the instant the match was PLACED at, not from
    // data.date — a season whose captures were all RANK screens carries no
    // date field, and counted that way printed "5 games, 0 days played".
    days.add(new Date(t).toDateString())
    const len = parseGameLengthMinutes(rec.data?.game_length)
    if (len !== null) {
      minutes += len
      anyLength = true
    }
  }
  const decisive = tally.wins + tally.losses

  return {
    season: season.name,
    games: inSeason.length,
    wins: tally.wins,
    losses: tally.losses,
    draws: tally.draws,
    winratePct: decisive === 0 ? null : Math.round((tally.wins / decisive) * 100),
    hoursPlayed: anyLength ? Math.round((minutes / 60) * 10) / 10 : null,
    rankStart: rankLabelAt(inSeason, 'first'),
    rankEnd: rankLabelAt(inSeason, 'last'),
    topHeroes: topBy(inSeason, (r) => r.data?.hero),
    topMaps: topBy(inSeason, (r) => r.data?.map),
    daysPlayed: days.size,
    longestWinStreak: longestWinStreak(inSeason.map(({ rec }) => rec.data?.result)),
  }
}

function countResult(into: { wins: number; losses: number; draws: number }, result: string | undefined): void {
  if (result === 'victory') into.wins++
  else if (result === 'defeat') into.losses++
  else if (result === 'draw') into.draws++
}

// The rank at one end of the season, or null. Null rather than a tier the
// player never saw: a season with no rank capture has an unknown start, and
// "Bronze 5" is a place they may never have been.
function rankLabelAt(
  timed: readonly { rec: MatchRecord }[],
  end: 'first' | 'last',
): string | null {
  const ordered = end === 'first' ? timed : [...timed].reverse()
  for (const { rec } of ordered) {
    // isPlaceableRank is the ONE rule for "this reading is usable" — a tier
    // the ladder knows AND a division. Re-deriving it here is how the rank
    // charts and this page would come to disagree about the same capture.
    if (!isPlaceableRank(rec.data)) continue
    const tier = rec.data?.rank ?? ''
    return `${tier.charAt(0).toUpperCase() + tier.slice(1)} ${rec.data?.level}`
  }
  return null
}

// The most-played values of one dimension, games first and the better win rate
// breaking a tie — so two heroes at four games each read in the order a player
// would rank them.
function topBy(
  timed: readonly { rec: MatchRecord }[],
  keyOf: (rec: MatchRecord) => string | undefined,
): RecapHero[] {
  const buckets = new Map<string, { games: number; wins: number; decisive: number }>()
  for (const { rec } of timed) {
    const key = keyOf(rec)
    if (!key) continue
    const bucket = buckets.get(key) ?? { games: 0, wins: 0, decisive: 0 }
    bucket.games++
    if (rec.data?.result === 'victory' || rec.data?.result === 'defeat') {
      bucket.decisive++
      if (rec.data.result === 'victory') bucket.wins++
    }
    buckets.set(key, bucket)
  }
  return [...buckets.entries()]
    .map(([key, b]) => ({
      key,
      games: b.games,
      winratePct: b.decisive === 0 ? null : Math.round((b.wins / b.decisive) * 100),
    }))
    .sort((a, b) => b.games - a.games || (b.winratePct ?? -1) - (a.winratePct ?? -1))
    .slice(0, TOP_HEROES)
}

function longestWinStreak(results: readonly (string | undefined)[]): number {
  let best = 0
  let run = 0
  for (const r of results) {
    if (r === 'victory') {
      run++
      best = Math.max(best, run)
      continue
    }
    // A draw does not extend a win streak and does not end one either — the
    // same rule the streak widgets use.
    if (r === 'defeat') run = 0
  }
  return best
}

// ── the page ──────────────────────────────────────────────────────────────

export function buildSeasonRecap(input: SeasonRecapInput, css: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(input.season)} — season recap</title>
<style>${css}</style>
</head>
<body class="paper recap">
<main class="recap-page">
<header class="recap-head">
<p class="eyebrow">Season recap</p>
<h1 class="recap-h1">${escapeHTML(input.season)}</h1>
</header>
${input.games === 0 ? emptyBlock() : bodyBlocks(input)}
</main>
</body>
</html>`
}

// A season nobody played is a sentence, not a wall of zeros. "0%" over no
// games is a claim about form that nothing measured.
function emptyBlock(): string {
  return '<p class="recap-empty">No competitive games this season.</p>'
}

function bodyBlocks(input: SeasonRecapInput): string {
  return [
    `<section class="recap-headline">${statBlocks(input)}</section>`,
    rankBlock(input),
    listBlock('Most played', input.topHeroes),
    listBlock('Maps', input.topMaps),
  ].filter(Boolean).join('\n')
}

function statBlocks(input: SeasonRecapInput): string {
  const stats: { label: string; value: string }[] = [
    { label: 'Games', value: String(input.games) },
    { label: 'Record', value: `${input.wins}W-${input.losses}L${input.draws ? `-${input.draws}D` : ''}` },
    { label: 'Win rate', value: input.winratePct === null ? 'no decisive games' : `${input.winratePct}%` },
    { label: 'Days played', value: String(input.daysPlayed) },
    { label: 'Longest win streak', value: String(input.longestWinStreak) },
  ]
  if (input.hoursPlayed !== null) {
    stats.push({ label: 'Hours', value: String(input.hoursPlayed) })
  }
  return stats.map((s) =>
    `<div class="recap-stat"><span class="eyebrow">${escapeHTML(s.label)}</span>`
    + `<strong class="recap-stat-value">${escapeHTML(s.value)}</strong></div>`).join('')
}

// Absent entirely when neither end was captured — a climb nobody read is not
// a flat season.
function rankBlock(input: SeasonRecapInput): string {
  if (input.rankStart === null && input.rankEnd === null) return ''
  const from = input.rankStart === null ? 'unread' : input.rankStart
  const to = input.rankEnd === null ? 'unread' : input.rankEnd
  return '<section class="recap-rank"><h2 class="recap-h2">The climb</h2>'
    + `<p class="recap-rank-line"><span>${escapeHTML(from)}</span>`
    + '<span class="recap-arrow" aria-hidden="true">→</span>'
    + `<span>${escapeHTML(to)}</span></p></section>`
}

function listBlock(heading: string, rows: readonly RecapHero[]): string {
  if (rows.length === 0) return ''
  const items = rows.map((r) =>
    `<li class="recap-row"><span class="recap-row-key">${escapeHTML(r.key)}</span>`
    + `<span class="recap-row-games">${escapeHTML(String(r.games))}x</span>`
    + `<span class="recap-row-rate">${escapeHTML(r.winratePct === null ? 'no decisive games' : `${r.winratePct}%`)}</span></li>`).join('')
  return `<section class="recap-list"><h2 class="recap-h2">${escapeHTML(heading)}</h2><ul>${items}</ul></section>`
}
