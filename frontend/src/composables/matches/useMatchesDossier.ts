import { computed, type Ref } from 'vue'
import type { MatchRecord } from '@/api'
import { formatPlayMinutes, parseGameLengthMinutes, type WeekStart } from '@/match/match-time-helpers'
import { formatToHundredths } from '@/match/match-stats-helpers'
import { useDossierQueries } from '@/composables/matches/useMatchesDossierQueries'
import { useMatchesTrends } from '@/composables/matches/useMatchesTrends'
import { useMatchesMomentum } from '@/composables/matches/useMatchesMomentum'
import {
  type LeaverHandling,
  type WinLossDraw,
  type BreakdownEntry,
  type AverageKDA,
  type TotalTimePlayed,
  type ReviewedCount,
  type DaysSinceLastReview,
  type Role,
  type RoleBreakdownEntry,
  type WLDSinceLastReview,
  type HeroRoleResolver,
  type CurrentStreak,
  isCanonRole,
} from '@/composables/matches/useMatchesDossier.types'

// Re-export the dossier's type/const contract so existing call sites
// that import these names from this module keep working unchanged.
export * from '@/composables/matches/useMatchesDossier.types'

// Pure KPI / breakdown computations for the Matches dossier.
// Extracted from MatchesView so the tally math (winrate excluding
// draws from the denominator, top-N breakdowns, leaver-tally
// exclusion) is testable in isolation. No DOM, no Vue components —
// just `Ref<MatchRecord[]>` in, `ComputedRef` out.
//
// Shape: two-tier surface modeled on a dashboard's data-source +
// panel-options vocabulary. Bedrock values that have no user-tunable
// knobs (W/L/D, winrate, total time played, etc.) ship as
// `ComputedRef<T>`. Knob-bearing surfaces (top-N breakdowns,
// thresholds, bucket counts) ship as parameterized query helpers:
// each takes a `MaybeRefOrGetter<Opts>` so callers can pass plain
// values OR a reactive getter that pulls from the widget's
// useWidgetConfig output. PR B added the surface with hardcoded
// callers; PR C populates the per-widget config schemas so widgets
// wire their own knobs through.
//
// Each query helper opens its own `computed()` so multiple call sites
// share Vue's reactive cache when their toValue()-resolved opts are
// shallowly equal — i.e. two widgets both asking for "top 5 by
// data.map" don't trigger two scans. The N-walks-vs-1-walk worry of
// the precomputed-refs design is moot at this corpus size (≤ 50k
// records is the obsessive case).

export function useMatchesDossier(
  records: Readonly<Ref<MatchRecord[]>>,
  leaverHandling: Readonly<Ref<LeaverHandling>>,
  heroRole?: HeroRoleResolver,
  weekStart?: Readonly<Ref<WeekStart>>,
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

  // Play-mode breakdown (Quickplay vs Competitive). Returns exactly
  // three fixed entries — 'quickplay', 'competitive', '—' (unset) —
  // so the bar layout doesn't reflow as the narrowed corpus changes.
  // Drives both the share-of-matches widget and the
  // winrate-by-play-mode widget; each picks a different field off the
  // BreakdownEntry as its bar metric.
  const playModeBreakdown = computed<BreakdownEntry[]>(() => {
    type Bucket = { total: number; w: number; l: number }
    const buckets: Record<'quickplay' | 'competitive' | '—', Bucket> = {
      quickplay:   { total: 0, w: 0, l: 0 },
      competitive: { total: 0, w: 0, l: 0 },
      '—':         { total: 0, w: 0, l: 0 },
    }
    for (const r of records.value) {
      const mode = r.play_mode === 'quickplay' || r.play_mode === 'competitive'
        ? r.play_mode
        : '—'
      const b = buckets[mode]
      b.total++
      if (r.data?.result === 'victory') b.w++
      else if (r.data?.result === 'defeat') b.l++
    }
    const denom = buckets.quickplay.total + buckets.competitive.total + buckets['—'].total
    return (['quickplay', 'competitive', '—'] as const).map((key) => {
      const b = buckets[key]
      const decided = b.w + b.l
      return {
        key,
        total:   b.total,
        winrate: decided === 0 ? 0 : Math.round((b.w / decided) * 100),
        share:   denom === 0 ? 0 : Math.round((b.total / denom) * 100),
      }
    })
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

  // ─── PR B: opt-in widgets (defaultVisible: false in registry) ──

  // Current streak — the contiguous run of the same decisive result
  // ending at the most-recent match. Walks `tallyRecords` sorted by
  // `parsed_at` desc and stops at the first transition. Records
  // without a decisive result are skipped (a draw next to a
  // victory doesn't break the streak only if you consider it a
  // result; we treat W/L/D as their own classes for streaks). The
  // tile's subtitle pulls from `sinceDate` so the read is "5W since
  // 2026-05-04" rather than just "5W".
  const currentStreak = computed<CurrentStreak>(() => {
    const sorted = tallyRecords.value
      .filter((r) => r.data?.result === 'victory' || r.data?.result === 'defeat' || r.data?.result === 'draw')
      .slice()
      .sort((a, b) => (b.parsed_at ?? '').localeCompare(a.parsed_at ?? ''))
    if (sorted.length === 0) return { count: 0, result: null, sinceDate: null }
    const result = sorted[0]!.data!.result as 'victory' | 'defeat' | 'draw'
    let count = 0
    let sinceDate: string | null = null
    for (const r of sorted) {
      if (r.data?.result !== result) break
      count++
      sinceDate = r.data?.date ?? sinceDate
    }
    return { count, result, sinceDate }
  })

  // Longest win streak — single chronological pass over
  // `tallyRecords`, tracking the largest contiguous `victory` run.
  // Sorted ascending by parsed_at so the walk reads as "earliest
  // first" (matching how a streak forms in time).
  const longestWinStreak = computed<number>(() => {
    const sorted = tallyRecords.value
      .slice()
      .sort((a, b) => (a.parsed_at ?? '').localeCompare(b.parsed_at ?? ''))
    let best = 0
    let current = 0
    for (const r of sorted) {
      if (r.data?.result === 'victory') {
        current++
        if (current > best) best = current
      } else if (r.data?.result === 'defeat' || r.data?.result === 'draw') {
        current = 0
      }
      // Records without a decisive result don't break the streak —
      // they're treated as unknown rather than a "no" vote.
    }
    return best
  })

  // Hero-pool size — distinct hero count across every match's
  // heroes_played[] union. Uses the full narrow, not tallyRecords,
  // because pool diversity is a workflow metric (the user wants to
  // see "how many distinct heroes I've touched" regardless of
  // leaver handling).
  const heroPoolSize = computed<number>(() => {
    const set = new Set<string>()
    for (const r of records.value) {
      for (const hp of r.data?.heroes_played ?? []) {
        if (hp.hero) set.add(hp.hero)
      }
    }
    return set.size
  })

  // Config-driven query-helper tier lives in its own composable; it
  // closes over the same narrowed records via the args passed here.
  const queries = useDossierQueries(records, tallyRecords, heroRole, weekStart)

  // Time-series over the same narrowed records, surfaced through the
  // dossier so the Trends charts honour the active filters like every
  // other consumer.
  const trends = useMatchesTrends(records)

  // Behavioural aggregates (tilt/momentum + climb/session) for the
  // opt-in KPI widgets, over the same narrowed records.
  const momentum = useMatchesMomentum(records)

  return {
    // ─── Bedrock — no per-widget config, precomputed refs ─────
    wld,
    winrate,
    totalTimePlayed,
    averageKDA,
    reviewedCount,
    daysSinceLastReview,
    wldSinceLastReview,
    currentStreak,
    longestWinStreak,
    heroPoolSize,
    topRoles,
    playModeBreakdown,
    // ─── Query helpers — config-driven, return reactive results
    ...queries,
    // ─── Time-series — reactive trend lines over the narrowed set ─
    ...trends,
    // ─── Behavioural KPIs — tilt/momentum + climb/session ─────────
    ...momentum,
  }
}

// The structural type widgets `inject` via useDossier. Mirrors
// useMatchesDossier's return shape so consumers can name a single
// type for the injected value without re-deriving it on every site.
export type MatchesDossier = ReturnType<typeof useMatchesDossier>
