import { computed, type Ref } from 'vue'
import type { MatchRecord } from '../api'
import { formatPlayMinutes, formatToHundredths, parseGameLengthMinutes } from '../match-helpers'

// Pure KPI / breakdown computations for the Matches dossier.
// Extracted from MatchesView so the tally math (winrate excluding
// draws from the denominator, top-N breakdowns, leaver-tally
// exclusion) is testable in isolation. No DOM, no Vue components —
// just `Ref<MatchRecord[]>` in, `ComputedRef` out.

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

// Minimum heroes_played[].percent_played for a record to count
// toward the most-played-hero win-rate denom. Picked at 20% so a
// brief experimental swap doesn't drag the rate around, but the
// canonical "split your time across two heroes" case (e.g.
// 60/40 ana/baptiste) still attributes win/loss to both.
const MOST_PLAYED_HERO_THRESHOLD = 20

// Maps a hero name to its canonical role. Production passes
// `useOWData().heroRole`; tests pass a small mock. Returning
// undefined / '' / a non-canonical-role value drops the hero from
// the role-set for that match.
export type HeroRoleResolver = (hero: string) => string | undefined

function isCanonRole(s: string | undefined | null): s is Role {
  return s === 'tank' || s === 'dps' || s === 'support'
}

export function useMatchesDossier(
  records: Readonly<Ref<MatchRecord[]>>,
  leaverHandling: Readonly<Ref<LeaverHandling>>,
  heroRole?: HeroRoleResolver,
) {
  // 'exclude-tally' drops leaver-annotated records from the KPIs
  // (W/L/D + winrate) only. The leaves list still shows them — the
  // user explicitly asked for "drop from tally" not "hide". 'hide'
  // is upstream of this composable: the caller is expected to have
  // already filtered those rows out of `records`.
  const tallyRecords = computed(() => {
    if (leaverHandling.value === 'exclude-tally') {
      return records.value.filter((r) => !r.annotation?.leaver)
    }
    return records.value
  })

  const wld = computed<WinLossDraw>(() => {
    let w = 0, l = 0, d = 0
    for (const r of tallyRecords.value) {
      const result = r.data?.result
      if (result === 'victory') w++
      else if (result === 'defeat') l++
      else if (result === 'draw') d++
    }
    return { w, l, d, total: w + l + d }
  })

  const winrate = computed<number | null>(() => {
    const t = wld.value
    const denom = t.w + t.l
    return denom === 0 ? null : Math.round((t.w / denom) * 100)
  })

  // Generic top-N-by-count builder. The full record set drives the
  // breakdown (NOT tallyRecords) so a user filtering "exclude-tally"
  // for leavers still sees leaver-affected maps in the breakdown —
  // the per-cell winrate then reads pre-tally-exclusion. We can
  // reconsider that if a user reports it as confusing; for now the
  // simpler "everything counts here" rule wins.
  function topByCount(getter: (r: MatchRecord) => string | undefined, limit = 5): BreakdownEntry[] {
    const counts = new Map<string, { total: number; w: number; l: number }>()
    for (const r of records.value) {
      const key = getter(r)
      if (!key) continue
      const entry = counts.get(key) ?? { total: 0, w: 0, l: 0 }
      entry.total++
      if (r.data?.result === 'victory') entry.w++
      else if (r.data?.result === 'defeat') entry.l++
      counts.set(key, entry)
    }
    // Share denominator is "total records that contributed a key" —
    // records without the field (no map / no hero) don't dilute the
    // percentages of the ones that did. With 100 matches, 95 of
    // them on parseable maps, an Atlas count of 30 reports as
    // 30 / 95 ≈ 32 % share, not 30 / 100.
    const totalForBreakdown = [...counts.values()].reduce((sum, c) => sum + c.total, 0)
    return [...counts.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, limit)
      .map(([key, c]) => ({
        key,
        total: c.total,
        winrate: c.w + c.l === 0 ? 0 : Math.round((c.w / (c.w + c.l)) * 100),
        share: totalForBreakdown === 0 ? 0 : Math.round((c.total / totalForBreakdown) * 100),
      }))
  }

  const topMaps   = computed(() => topByCount((r) => r.data?.map))

  // Top heroes by SUMMED play time across every heroes_played[]
  // entry — not by primary-hero match count. The dossier's bar
  // visualization then reads "what hero did you spend the most time
  // on" rather than "what hero did you click first most often."
  // Limit defaults to 3 (vs topMaps' 5) because the time-based row
  // carries a longer label ("7h32min") that needs room to breathe in
  // the breakdown grid. Records whose heroes_played[] is missing or
  // whose entries lack a parseable play_time contribute nothing.
  const topHeroes = computed<HeroBreakdownEntry[]>(() => {
    const buckets = new Map<string, { minutes: number; w: number; l: number }>()
    for (const r of records.value) {
      const heroes = r.data?.heroes_played ?? []
      for (const hp of heroes) {
        if (!hp.hero) continue
        const m = parseGameLengthMinutes(hp.play_time)
        if (m === null) continue
        const bucket = buckets.get(hp.hero) ?? { minutes: 0, w: 0, l: 0 }
        bucket.minutes += m
        if (r.data?.result === 'victory') bucket.w++
        else if (r.data?.result === 'defeat') bucket.l++
        buckets.set(hp.hero, bucket)
      }
    }
    const totalMinutes = [...buckets.values()].reduce((sum, b) => sum + b.minutes, 0)
    return [...buckets.entries()]
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .slice(0, 3)
      .map(([key, b]) => ({
        key,
        totalMinutes: b.minutes,
        share: totalMinutes === 0 ? 0 : Math.round((b.minutes / totalMinutes) * 100),
        winrate: b.w + b.l === 0 ? 0 : Math.round((b.w / (b.w + b.l)) * 100),
        timeLabel: formatPlayMinutes(b.minutes),
      }))
  })

  // Total match time across the tally-eligible records. Sourced
  // from data.game_length (the SUMMARY screen's "match length"
  // field) — NOT from heroes_played[].play_time. game_length is
  // the wall-clock duration of the match; summing per-hero times
  // would either equal it (single-hero match) or undercount
  // (heroes_played omits the spectator gap between hero swaps and
  // doesn't carry play_time for swaps captured only in SCOREBOARD).
  // Records lacking a parseable game_length contribute nothing —
  // we don't fabricate a number from adjacent fields; recordsWithTime
  // exposes the coverage so the KPI tile can surface "N of M" when
  // it's not 1:1.
  const totalTimePlayed = computed<TotalTimePlayed>(() => {
    let minutes = 0
    let recordsWithTime = 0
    for (const r of tallyRecords.value) {
      const m = parseGameLengthMinutes(r.data?.game_length)
      if (m === null) continue
      minutes += m
      recordsWithTime++
    }
    return {
      minutes,
      label: recordsWithTime === 0 ? '—' : formatPlayMinutes(minutes),
      recordsWithTime,
      recordsTotal: tallyRecords.value.length,
    }
  })

  // Win-rate annotation for the Most-played-hero KPI tile. Sources
  // the hero name from topHeroes[0] (time-ranked) and the W/L
  // counts from records where that hero's percent_played cleared
  // MOST_PLAYED_HERO_THRESHOLD. Draws skip both buckets (same rule
  // as the headline winrate). Null winrate when no qualifying
  // decisive matches exist — caller renders the hero name without
  // a percentage in that case.
  const mostPlayedHero = computed<MostPlayedHero | null>(() => {
    const top = topHeroes.value[0]
    if (!top) return null
    let w = 0, l = 0
    for (const r of tallyRecords.value) {
      const played = (r.data?.heroes_played ?? []).find((hp) => hp.hero === top.key)
      if (!played) continue
      if ((played.percent_played ?? 0) < MOST_PLAYED_HERO_THRESHOLD) continue
      if (r.data?.result === 'victory') w++
      else if (r.data?.result === 'defeat') l++
    }
    const qualifyingMatches = w + l
    return {
      key: top.key,
      winrate: qualifyingMatches === 0 ? null : Math.round((w / qualifyingMatches) * 100),
      qualifyingMatches,
    }
  })

  // Average per-10-min K/D/A across the tally-eligible records.
  // Only records carrying ALL three avg_per_10min fields contribute
  // — a missing field would otherwise pull the average against
  // zero, which is misleading. K/D/A ordering follows gaming
  // convention: Kills (eliminations) / Deaths / Assists.
  const averageKDA = computed<AverageKDA | null>(() => {
    let elimSum = 0, deathSum = 0, assistSum = 0
    let qualifyingMatches = 0
    for (const r of tallyRecords.value) {
      const p = r.data?.performance
      if (!p) continue
      const elim    = p.eliminations?.avg_per_10min
      const deaths  = p.deaths?.avg_per_10min
      const assists = p.assists?.avg_per_10min
      if (elim === undefined || deaths === undefined || assists === undefined) continue
      elimSum   += elim
      deathSum  += deaths
      assistSum += assists
      qualifyingMatches++
    }
    if (qualifyingMatches === 0) return null
    const e = elimSum / qualifyingMatches
    const d = deathSum / qualifyingMatches
    const a = assistSum / qualifyingMatches
    return {
      eliminations: e,
      deaths: d,
      assists: a,
      label: `${formatToHundredths(e)} / ${formatToHundredths(d)} / ${formatToHundredths(a)}`,
      qualifyingMatches,
      recordsTotal: tallyRecords.value.length,
    }
  })

  // Review-coverage widget — how many of the narrow's matches the
  // user (or a coach) has reviewed. Counts every record whose
  // `reviewed_by` is non-empty; the empty/absent case maps to "not
  // reviewed." Uses the full narrow (NOT tallyRecords) so flipping
  // leaver-handling doesn't ghost-bump the percentage — review
  // coverage is a workflow metric, not a tally metric.
  const reviewedCount = computed<ReviewedCount>(() => {
    let reviewed = 0
    for (const r of records.value) {
      if (r.reviewed_by) reviewed++
    }
    const total = records.value.length
    const percent = total === 0 ? 0 : Math.round((reviewed / total) * 100)
    return { reviewed, total, percent }
  })

  // Days since the most-recent `reviewed_at` in the narrow. We
  // floor the elapsed milliseconds to whole days; "reviewed 4
  // hours ago" reads as `0` days (the tile then surfaces "today"
  // semantics via the caller-side label) and "exactly 24h ago"
  // reads as `1`. Null when nothing in the narrow has been
  // reviewed. Date.now() is read at evaluation time — Vue's
  // reactivity won't ticking re-fire this; callers that need the
  // value to refresh past midnight should re-invoke (or bind to a
  // ref that pulses).
  const daysSinceLastReview = computed<DaysSinceLastReview>(() => {
    let latestMs: number | null = null
    let latestIso: string | null = null
    for (const r of records.value) {
      if (!r.reviewed_at) continue
      const ms = Date.parse(r.reviewed_at)
      if (Number.isNaN(ms)) continue
      if (latestMs === null || ms > latestMs) {
        latestMs = ms
        latestIso = r.reviewed_at
      }
    }
    if (latestMs === null) {
      return { days: null, lastReviewedAt: null }
    }
    const elapsedMs = Date.now() - latestMs
    const days = Math.max(0, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)))
    return { days, lastReviewedAt: latestIso }
  })

  // W/L/D over matches whose parsed_at lands AFTER the most-recent
  // review pass. "Since last review" reads as a workflow window:
  // *what's my record on stuff I haven't reviewed yet?* parsed_at
  // is the canonical server-stamped timestamp on MatchRecord;
  // comparing it (UTC) against reviewed_at (also server UTC) avoids
  // the timezone hell that data.date / data.finished_at would
  // introduce (those mirror the OW client's local-time display).
  //
  // Returns null when nothing in the narrow has been reviewed —
  // there's no anchor to count "since" from, and the tile renders
  // an em-dash. Once the user records their first review, the next
  // tick of this widget snaps to the new baseline.
  const wldSinceLastReview = computed<WLDSinceLastReview | null>(() => {
    const ref = daysSinceLastReview.value.lastReviewedAt
    if (!ref) return null
    let w = 0, l = 0, d = 0
    for (const r of tallyRecords.value) {
      if (!r.parsed_at) continue
      // ISO-8601 strings sort lexicographically when they share a
      // canonical Z-suffixed shape (which the server emits). A loose
      // string compare avoids a Date round-trip per record.
      if (r.parsed_at <= ref) continue
      const result = r.data?.result
      if (result === 'victory') w++
      else if (result === 'defeat') l++
      else if (result === 'draw') d++
    }
    return { w, l, d, total: w + l + d, referenceAt: ref }
  })

  // Role-share breakdown — symmetric with topMaps + topHeroes in
  // the breakdown row, but with overlap-aware percentages.
  //
  // Each match's role-set is the union of: (a) the primary
  // `data.role` if canonical, AND (b) every role inferred from
  // `data.heroes_played[*].hero` via the resolver. The set is
  // deduped per match — a match where you played only Lúcio (one
  // hero, support role) contributes 1 to support, not 1 + 1. Open
  // queue matches where you swapped from tank to dps contribute 1
  // to each, so the row's percentages can sum to >100%.
  //
  // Percentage denominator is `total_matches`, NOT the sum of
  // role-counts — so each bar reads as "what fraction of my matches
  // included this role." Overlap makes the row sum >100%, which is
  // the desired open-queue signal. Sorted descending by count so the
  // dominant role surfaces first.
  const topRoles = computed<RoleBreakdownEntry[]>(() => {
    const totalMatches = records.value.length
    const counts: Record<Role, { total: number; w: number; l: number }> = {
      tank: { total: 0, w: 0, l: 0 },
      dps: { total: 0, w: 0, l: 0 },
      support: { total: 0, w: 0, l: 0 },
    }
    for (const r of records.value) {
      const rolesInMatch = new Set<Role>()
      if (isCanonRole(r.data?.role)) rolesInMatch.add(r.data.role)
      if (heroRole) {
        for (const hp of r.data?.heroes_played ?? []) {
          if (!hp.hero) continue
          const role = heroRole(hp.hero)
          if (isCanonRole(role)) rolesInMatch.add(role)
        }
      }
      for (const role of rolesInMatch) {
        counts[role].total++
        if (r.data?.result === 'victory') counts[role].w++
        else if (r.data?.result === 'defeat') counts[role].l++
      }
    }
    const ROLES: Role[] = ['tank', 'dps', 'support']
    return ROLES
      .map<RoleBreakdownEntry>((key) => {
        const c = counts[key]
        return {
          key,
          total: c.total,
          share: totalMatches === 0 ? 0 : Math.round((c.total / totalMatches) * 100),
          winrate: c.w + c.l === 0 ? 0 : Math.round((c.w / (c.w + c.l)) * 100),
        }
      })
      .sort((a, b) => b.total - a.total)
  })

  return {
    wld, winrate, topMaps, topHeroes, topRoles, totalTimePlayed, mostPlayedHero, averageKDA,
    reviewedCount, daysSinceLastReview, wldSinceLastReview,
  }
}
