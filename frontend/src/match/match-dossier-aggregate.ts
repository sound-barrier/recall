import type { MatchRecord } from '@/api-client'
import {
  type WldTally,
  bumpDecisive,
  bumpTally,
  inTrailingWindow,
  newTally,
  sharePct,
  winrateOrNull,
  winratePct,
} from '@/match/match-dossier-tally'
import { formatPlayMinutes, parseGameLengthMinutes, type WeekStart } from '@/match/match-time-helpers'
import { formatPlayModeLabel, formatQueueTypeLabel } from '@/match/match-label-helpers'
import { RESULT_MODIFIERS } from '@/match/match-trends-helpers'
import { wilsonLowerBound, LOW_SAMPLE_N } from '@/match/match-sample-helpers'
import {
  type BestWinrateHero,
  type BreakdownEntry,
  type BucketEntry,
  type HeroBreakdownEntry,
  type HeroGameModeCell,
  type HeroRoleResolver,
  type MapCountRow,
  type MapRoleCell,
  type ModifierRecord,
  type MostPlayedHero,
  type RecentMatchRow,
  type Role,
  DAY_OF_WEEK_LABELS,
  isCanonRole,
  makeTimeOfDayLabels,
} from '@/composables/matches/useMatchesDossier.types'

// The dossier's per-query aggregation kernels: pure functions over
// (records, opts) that useDossierQueries wraps in thin computeds. The
// CALLER decides which record set each kernel sees — the full narrowed
// set vs. the tally-eligible subset differ deliberately per widget (the
// comments in useMatchesDossierQueries.ts explain each choice), so the
// kernels never pick a denominator on their own.

// Shared tail of every count-shaped breakdown (top-N maps / modes /
// modifiers / teammates): rank by count, cap, and report share over
// the records that contributed a key — records without the field (no
// map / no hero) don't dilute the percentages of the ones that did.
// With 100 matches, 95 of them on parseable maps, an Atlas count of 30
// reports as 30 / 95 ≈ 32 % share, not 30 / 100.
function rankedCountRows(counts: Map<string, WldTally>, limit: number): BreakdownEntry[] {
  const totalForBreakdown = [...counts.values()].reduce((sum, c) => sum + c.total, 0)
  return [...counts.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, limit)
    .map(([key, c]) => ({
      key,
      total: c.total,
      winrate: winratePct(c.w, c.l),
      share: sharePct(c.total, totalForBreakdown),
    }))
}

// Generic top-N-by-count aggregation over an arbitrary key getter —
// the kernel behind the top-maps, top-heroes-by-count, and
// top-game-modes widgets.
export function topByCountRows(
  records: MatchRecord[],
  getter: (r: MatchRecord) => string | undefined,
  limit: number,
): BreakdownEntry[] {
  const counts = new Map<string, WldTally>()
  for (const r of records) {
    const key = getter(r)
    if (!key) continue
    const entry = counts.get(key) ?? newTally()
    bumpTally(entry, r.data?.result)
    counts.set(key, entry)
  }
  return rankedCountRows(counts, limit)
}

type RankedWinrateRow = BreakdownEntry & { rank: number }

function toWinrateRow(key: string, w: number, l: number): RankedWinrateRow {
  const total = w + l
  const winrate = Math.round((w / total) * 100)
  // share === winrate so the shared breakdown bar renders the
  // win-rate; the widgets read `winrate` directly regardless.
  // Ranking uses the Wilson lower bound, NOT the raw winrate:
  // a thin perfect sample must not outrank a solid good one
  // (sample-size honesty; the displayed % stays raw).
  return {
    key, total, winrate, wins: w, share: winrate,
    lowSample: total < LOW_SAMPLE_N,
    rank: wilsonLowerBound(w, total),
  }
}

// Win rate by an arbitrary dimension (hero / map / role), ranked
// best → worst by Wilson lower bound. Only decisive matches count
// (draws excluded, as in the headline winrate); `total` is the
// decisive sample behind each rate and doubles as the `minMatches`
// qualification gate so a 100% rate over one game doesn't top the list.
export function winrateByRows(
  records: MatchRecord[],
  getter: (r: MatchRecord) => string | undefined,
  minMatches: number,
  limit: number,
): BreakdownEntry[] {
  const buckets = new Map<string, { w: number; l: number }>()
  for (const r of records) {
    const result = r.data?.result
    if (result !== 'victory' && result !== 'defeat') continue
    const key = getter(r)
    if (!key) continue
    const bucket = buckets.get(key) ?? { w: 0, l: 0 }
    if (result === 'victory') bucket.w++
    else bucket.l++
    buckets.set(key, bucket)
  }
  return [...buckets.entries()]
    .map(([key, { w, l }]) => toWinrateRow(key, w, l))
    .filter((e) => e.total >= minMatches)
    .sort((a, b) => b.rank - a.rank || b.total - a.total)
    .slice(0, limit)
}

// Count + win-rate per non-result modifier — the rank-update pills
// (uphill battle, reversal, consolation, win/loss streak, calibration,
// volatile, demotion protection). A match carries several modifiers, so
// it counts toward each: the buckets overlap by design. Victory / defeat
// / draw are excluded (they're the result, already the headline W/L/D).
// Ranked by frequency.
export function modifierBreakdownRows(records: MatchRecord[], limit: number): BreakdownEntry[] {
  const counts = new Map<string, WldTally>()
  for (const r of records) {
    for (const modifier of r.data?.modifiers ?? []) {
      if (!modifier || RESULT_MODIFIERS.has(modifier)) continue
      const entry = counts.get(modifier) ?? newTally()
      bumpTally(entry, r.data?.result)
      counts.set(modifier, entry)
    }
  }
  return rankedCountRows(counts, limit)
}

// Count + win-rate for ONE modifier — drives the Uphill Battle / Reversal
// KPI tiles ("how often do I clutch as the underdog / choke when
// favored"). Null when the modifier never appears in the set.
export function modifierRecordFor(records: MatchRecord[], modifier: string): ModifierRecord | null {
  const tally = newTally()
  for (const r of records) {
    if (!(r.data?.modifiers ?? []).includes(modifier)) continue
    bumpTally(tally, r.data?.result)
  }
  if (tally.total === 0) return null
  return { total: tally.total, winrate: winrateOrNull(tally.w, tally.w + tally.l) }
}

// Win rate by teammate — buckets the set by who you played WITH
// (annotation.members), plus a "Solo" bucket for matches with no
// teammates recorded. A match with members {A, B} counts toward BOTH
// A and B (and never Solo), so the buckets overlap by design: the
// question is "how do I do when X is on my team," answered per
// teammate. Ranked by games-together so the people you grind with
// most lead; `total` doubles as the sample-size guard (a 100% win
// rate over one game is noise, over fifty is signal).
export function withWhomRows(records: MatchRecord[], limit: number): BreakdownEntry[] {
  const counts = new Map<string, WldTally>()
  const bump = (key: string, r: MatchRecord) => {
    const entry = counts.get(key) ?? newTally()
    bumpTally(entry, r.data?.result)
    counts.set(key, entry)
  }
  for (const r of records) {
    const members = (r.annotation?.members ?? []).filter(Boolean)
    if (members.length === 0) bump('Solo', r)
    else for (const m of members) bump(m, r)
  }
  return rankedCountRows(counts, limit)
}

// Mirrors the keys exposed by `pkg/parser/maps.yaml` — the
// canonical 6 Overwatch game-mode slugs. Hardcoded so the heatmap
// renders its column header row deterministically even on first
// mount before `useOWData()` resolves; if the parser ever ships a
// new game-mode, this list updates in lockstep with the YAML.
const CANONICAL_GAME_MODES = ['control', 'escort', 'flashpoint', 'hybrid', 'push', 'clash'] as const

function cellKey(hero: string, gameMode: string): string {
  return `${hero}\0${gameMode}`
}

// Records contribute multiple cells when their heroes_played[] has
// multiple entries (open-queue match where the user hero-swapped) —
// each DISTINCT hero gets credit once. A record with no
// heroes_played[] falls back to the primary data.hero; a populated
// list whose entries all lack a hero name credits nothing.
function creditedHeroes(r: MatchRecord): string[] {
  const heroes = r.data?.heroes_played ?? []
  if (heroes.length === 0) return r.data?.hero ? [r.data.hero] : []
  const distinct = new Set<string>()
  for (const hp of heroes) {
    if (hp.hero) distinct.add(hp.hero)
  }
  return [...distinct]
}

// Pick the top heroes by total appearances (the heatmap only shows
// that subset to keep the grid scannable on viewport), then display
// A→Z so the rows read as a stable alphabetical list (matching the
// columns).
function topNHeroes(heroTotals: Map<string, number>, limit: number): string[] {
  return [...heroTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hero]) => hero)
    .sort((a, b) => a.localeCompare(b))
}

// Materialize every (top-hero, game-mode) cell — including zeros — so
// the grid layout is rectangular. The widget renders the empty cells
// as a flat surface tone (no border, no glyph) so the eye reads the
// populated cells first. Columns A→Z too — sort a copy so the
// canonical-order constant stays intact for any other consumer.
function materializeHeroModeGrid(cells: Map<string, WldTally>, topHeroes: string[]): HeroGameModeCell[] {
  const orderedModes = [...CANONICAL_GAME_MODES].sort((a, b) => a.localeCompare(b))
  const out: HeroGameModeCell[] = []
  for (const hero of topHeroes) {
    for (const gameMode of orderedModes) {
      const b = cells.get(cellKey(hero, gameMode)) ?? newTally()
      out.push({
        hero,
        gameMode,
        wins:   b.w,
        losses: b.l,
        draws:  b.d,
        total:  b.total,
        winrate: winratePct(b.w, b.l),
      })
    }
  }
  return out
}

// Hero × Game-Mode breakdown: a flat rectangular list the heatmap
// widget pivots into a 2-D grid (rows = top-N heroes, columns = the
// canonical 6 game modes). Records whose game_mode is missing or that
// fall outside the trailing window drop out — the heatmap deliberately
// doesn't show an "unknown" column because it would carry no
// actionable signal (you can't "play unknown maps better").
export function heroGameModeCells(
  records: MatchRecord[],
  heroLimit: number,
  cutoff: string,
): HeroGameModeCell[] {
  const cells = new Map<string, WldTally>()
  const heroTotals = new Map<string, number>()
  for (const r of records) {
    const gameMode = r.data?.game_mode
    if (!gameMode || !inTrailingWindow(r, cutoff)) continue
    for (const hero of creditedHeroes(r)) {
      const b = cells.get(cellKey(hero, gameMode)) ?? newTally()
      bumpTally(b, r.data?.result)
      cells.set(cellKey(hero, gameMode), b)
      heroTotals.set(hero, (heroTotals.get(hero) ?? 0) + 1)
    }
  }
  return materializeHeroModeGrid(cells, topNHeroes(heroTotals, heroLimit))
}

// Top heroes by SUMMED play time across every heroes_played[] entry —
// not by primary-hero match count: "what hero did you spend the most
// time on," not "what hero did you click first most often." Records
// whose heroes_played[] is missing or whose entries lack a parseable
// play_time contribute nothing.
export function topHeroesByMinutesRows(records: MatchRecord[], limit: number): HeroBreakdownEntry[] {
  const buckets = new Map<string, { minutes: number; w: number; l: number }>()
  for (const r of records) {
    for (const hp of r.data?.heroes_played ?? []) {
      if (!hp.hero) continue
      const minutes = parseGameLengthMinutes(hp.play_time)
      if (minutes === null) continue
      const bucket = buckets.get(hp.hero) ?? { minutes: 0, w: 0, l: 0 }
      bucket.minutes += minutes
      bumpDecisive(bucket, r.data?.result)
      buckets.set(hp.hero, bucket)
    }
  }
  const totalMinutes = [...buckets.values()].reduce((sum, b) => sum + b.minutes, 0)
  return [...buckets.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .slice(0, limit)
    .map(([key, b]) => ({
      key,
      totalMinutes: b.minutes,
      share: sharePct(b.minutes, totalMinutes),
      winrate: winratePct(b.w, b.l),
      timeLabel: formatPlayMinutes(b.minutes),
    }))
}

// Win-rate annotation for the Most-played-hero KPI tile: W/L over the
// records where THIS hero's percent_played cleared the threshold.
// Draws skip both buckets (same rule as the headline winrate). Null
// winrate when no qualifying decisive matches exist — the caller
// renders the hero name without a percentage in that case.
export function mostPlayedHeroRecord(
  records: MatchRecord[],
  hero: string,
  minPercentPlayed: number,
): MostPlayedHero {
  const tally = { w: 0, l: 0 }
  for (const r of records) {
    const played = (r.data?.heroes_played ?? []).find((hp) => hp.hero === hero)
    if (!played || (played.percent_played ?? 0) < minPercentPlayed) continue
    bumpDecisive(tally, r.data?.result)
  }
  const qualifyingMatches = tally.w + tally.l
  return { key: hero, winrate: winrateOrNull(tally.w, qualifyingMatches), qualifyingMatches }
}

// Every canonical role a match touched: the primary data.role plus
// each heroes_played hero's role via the resolver, deduped per match.
// Non-canonical values (from either source) drop out.
function rolesTouched(r: MatchRecord, heroRole: HeroRoleResolver | undefined): Set<Role> {
  const roles = new Set<Role>()
  if (isCanonRole(r.data?.role)) roles.add(r.data.role)
  if (!heroRole) return roles
  for (const hp of r.data?.heroes_played ?? []) {
    if (!hp.hero) continue
    const role = heroRole(hp.hero)
    if (isCanonRole(role)) roles.add(role)
  }
  return roles
}

function toMapRoleCell(key: string, b: WldTally): MapRoleCell {
  const sep = key.lastIndexOf('|')
  return {
    map:   key.slice(0, sep),
    role:  key.slice(sep + 1) as MapRoleCell['role'],
    wins:   b.w,
    losses: b.l,
    draws:  b.d,
    total:  b.total,
    winrate: winratePct(b.w, b.l),
  }
}

// Map × Role performance — the data behind the Geography band.
// Symmetric with topRoles' overlap-aware role model, but keyed by
// (specific map × role) instead of role alone: each match credits
// every role it touched on that match's map. Records without a map
// drop out (no actionable column). Emits only populated cells; the
// band joins them against the full map roster from useOWData and
// renders the gaps as empty cells.
export function mapRoleCells(
  records: MatchRecord[],
  heroRole: HeroRoleResolver | undefined,
  cutoff: string,
): MapRoleCell[] {
  const cells = new Map<string, WldTally>()
  for (const r of records) {
    const map = r.data?.map
    if (!map || !inTrailingWindow(r, cutoff)) continue
    for (const role of rolesTouched(r, heroRole)) {
      const key = `${map}|${role}`
      const b = cells.get(key) ?? newTally()
      bumpTally(b, r.data?.result)
      cells.set(key, b)
    }
  }
  return [...cells.entries()].map(([key, b]) => toMapRoleCell(key, b))
}

// Per-map tally — the Hero × Game-Mode band's drill-down "maps" level
// reads this once the active set is already pinned to a hero +
// game-mode, so a flat by-map count is all it needs.
export function mapCountRows(records: MatchRecord[], cutoff: string): MapCountRow[] {
  const cells = new Map<string, WldTally>()
  for (const r of records) {
    const map = r.data?.map
    if (!map || !inTrailingWindow(r, cutoff)) continue
    const b = cells.get(map) ?? newTally()
    bumpTally(b, r.data?.result)
    cells.set(map, b)
  }
  return [...cells.entries()].map(([map, b]) => ({
    map,
    wins:   b.w,
    losses: b.l,
    draws:  b.d,
    total:  b.total,
    winrate: winratePct(b.w, b.l),
  }))
}

// Newest-PLAYED-first sort key: date + finished_at, falling back to
// parsed_at for records that can't place themselves on the calendar.
function playedSortKey(r: MatchRecord): string {
  return r.data?.date ? `${r.data.date}T${r.data.finished_at ?? ''}` : (r.parsed_at ?? '')
}

function toRecentMatchRow(r: MatchRecord): RecentMatchRow {
  const d = r.data ?? {}
  return {
    matchKey:   r.match_key,
    date:       d.date ?? '',
    finishedAt: d.finished_at ?? '',
    result:     d.result ?? '',
    map:        d.map ?? '',
    // Play mode + queue type read like the leaf-row chips; empty string
    // when unset so the drill row can render a "—" placeholder.
    mode:       (r.play_mode ?? d.playlist) ? formatPlayModeLabel(r) : '',
    queueType:  r.queue_type ? formatQueueTypeLabel(r) : '',
  }
}

// Recent individual matches — the band's deepest drill level (a
// specific hero × mode × map) shows the games that produced it,
// newest-played first, capped to `count`.
export function recentMatchRows(records: MatchRecord[], count: number, cutoff: string): RecentMatchRow[] {
  return records
    .filter((r) => inTrailingWindow(r, cutoff))
    .sort((a, b) => playedSortKey(b).localeCompare(playedSortKey(a)))
    .slice(0, count)
    .map(toRecentMatchRow)
}

// Heroes whose percent_played cleared the threshold in this record.
// Duplicated heroes_played entries each qualify — every occurrence
// bumps the tally, matching the pre-kernel behavior.
function qualifyingHeroes(r: MatchRecord, minPercentPlayed: number): string[] {
  const out: string[] = []
  for (const hp of r.data?.heroes_played ?? []) {
    if (!hp.hero || (hp.percent_played ?? 0) < minPercentPlayed) continue
    out.push(hp.hero)
  }
  return out
}

// Per-hero decisive W/L over records where the hero's percent_played
// cleared the threshold — the sample bestWinrateHeroRecord ranks.
function qualifyingHeroTallies(
  records: MatchRecord[],
  minPercentPlayed: number,
): Map<string, { w: number; l: number }> {
  const buckets = new Map<string, { w: number; l: number }>()
  for (const r of records) {
    const result = r.data?.result
    if (result !== 'victory' && result !== 'defeat') continue
    for (const hero of qualifyingHeroes(r, minPercentPlayed)) {
      const bucket = buckets.get(hero) ?? { w: 0, l: 0 }
      bumpDecisive(bucket, result)
      buckets.set(hero, bucket)
    }
  }
  return buckets
}

// Ties broken by qualifyingMatches desc (more sample = better signal).
function beatsBest(best: BestWinrateHero | null, winrate: number, qualifying: number): boolean {
  if (best === null) return true
  if (winrate !== best.winrate) return winrate > best.winrate
  return qualifying > best.qualifyingMatches
}

// Best hero by winrate, gated to ≥ `minPercentPlayed` percent play
// AND ≥ `minMatches` decisive qualifying matches. Null when no hero
// clears both gates.
export function bestWinrateHeroRecord(
  records: MatchRecord[],
  minPercentPlayed: number,
  minMatches: number,
): BestWinrateHero | null {
  let best: BestWinrateHero | null = null
  for (const [hero, { w, l }] of qualifyingHeroTallies(records, minPercentPlayed)) {
    const qualifying = w + l
    if (qualifying < minMatches) continue
    const winrate = Math.round((w / qualifying) * 100)
    if (beatsBest(best, winrate, qualifying)) {
      best = { key: hero, winrate, qualifyingMatches: qualifying }
    }
  }
  return best
}

// One bucket of a judged distribution (time-of-day / day-of-week):
// volume via `count`, judgment via decisive w/l.
interface JudgedBucketTally {
  count: number
  w: number
  l: number
}

function newBucketTally(): JudgedBucketTally {
  return { count: 0, w: 0, l: 0 }
}

// The judgment follows the same exclude-tally rule as every other
// win rate; the volume read keeps every played game — only records
// in the tally-eligible set move w/l.
function judgeResult(bucket: JudgedBucketTally, r: MatchRecord, inTally: ReadonlySet<MatchRecord>): void {
  if (!inTally.has(r)) return
  if (r.data?.result === 'victory') bucket.w++
  else if (r.data?.result === 'defeat') bucket.l++
}

// Rolls one bucket tally into the BucketEntry the time-of-day +
// day-of-week widgets render: volume (count/share) plus the win-rate
// judgment over the bucket's decisive games (null with none, so a
// played-but-undecided bucket reads as no-sample rather than 0%).
function toBucketEntry(label: string, tally: JudgedBucketTally, denom: number): BucketEntry {
  const decisive = tally.w + tally.l
  return {
    label,
    count: tally.count,
    share: sharePct(tally.count, denom),
    winrate: winrateOrNull(tally.w, decisive),
    wins: tally.w,
    decisive,
  }
}

// The `data.finished_at` HH:MM hour, or null when it doesn't parse to
// a valid 0–23 hour — unparseable records skip the distribution AND
// its share denominator.
function finishedHour(r: MatchRecord): number | null {
  const fa = r.data?.finished_at
  if (!fa || fa.length < 2) return null
  const hour = Number.parseInt(fa.slice(0, 2), 10)
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null
}

// Time-of-day distribution over `data.finished_at` — 6 buckets
// (4-hour windows) is the historical default; 12 (2-hour) and 24
// (1-hour) are the config choices. Share denominator = records WITH a
// parseable hour so the percentages reflect the workflow-relevant
// fraction of the narrow.
export function timeOfDayBucketRows(
  records: MatchRecord[],
  tallyRecords: MatchRecord[],
  bucketCount: 6 | 12 | 24,
): BucketEntry[] {
  const hoursPerBucket = 24 / bucketCount
  const tallies = Array.from({ length: bucketCount }, newBucketTally)
  const inTally = new Set(tallyRecords)
  let denom = 0
  for (const r of records) {
    const hour = finishedHour(r)
    if (hour === null) continue
    const bucket = tallies[Math.floor(hour / hoursPerBucket)]!
    bucket.count++
    denom++
    judgeResult(bucket, r, inTally)
  }
  return makeTimeOfDayLabels(bucketCount).map((label, i) => toBucketEntry(label, tallies[i]!, denom))
}

// Parse with explicit Z so getUTCDay() reads the user-meaningful
// date regardless of the local timezone the browser runs in —
// otherwise a 2026-05-10 record reads as Saturday in UTC-negative
// timezones and Sunday in UTC-leaning ones.
function utcDayOfWeek(date: string | undefined): number | null {
  if (!date) return null
  const day = new Date(date + 'T00:00:00Z').getUTCDay()
  return Number.isFinite(day) && day >= 0 && day <= 6 ? day : null
}

// Day-of-week distribution — seven buckets rotated so the row order
// starts on `weekStart` (Sun=0 .. Sat=6). Records without a parseable
// `data.date` skipped; share denominator = records WITH a parseable
// day. Same exclude-tally judgment split as timeOfDayBucketRows.
export function dayOfWeekBucketRows(
  records: MatchRecord[],
  tallyRecords: MatchRecord[],
  weekStart: WeekStart,
): BucketEntry[] {
  const tallies = Array.from({ length: 7 }, newBucketTally)
  const inTally = new Set(tallyRecords)
  let denom = 0
  for (const r of records) {
    const day = utcDayOfWeek(r.data?.date)
    if (day === null) continue
    const bucket = tallies[day]!
    bucket.count++
    denom++
    judgeResult(bucket, r, inTally)
  }
  const rotated: BucketEntry[] = []
  for (let i = 0; i < 7; i++) {
    const srcIdx = (weekStart + i) % 7
    rotated.push(toBucketEntry(DAY_OF_WEEK_LABELS[srcIdx]!, tallies[srcIdx]!, denom))
  }
  return rotated
}
