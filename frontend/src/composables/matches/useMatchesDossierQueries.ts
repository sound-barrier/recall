import { computed, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import type { MatchRecord } from '@/api'
import { formatPlayMinutes, parseGameLengthMinutes, type WeekStart } from '@/match/match-time-helpers'
import { RESULT_MODIFIERS } from '@/match/match-trends-helpers'
import {
  type BreakdownEntry,
  type ModifierRecord,
  type HeroBreakdownEntry,
  type MostPlayedHero,
  type BestWinrateHero,
  type BucketEntry,
  type MapRoleCell,
  type HeroRoleResolver,
  type Role,
  isCanonRole,
  monthsAgoISO,
  makeTimeOfDayLabels,
  DAY_OF_WEEK_LABELS,
} from '@/composables/matches/useMatchesDossier.types'

// The dossier's parameterized query-helper tier (the panel-options
// side). Each helper takes a MaybeRefOrGetter<Opts> and
// opens its own computed() so widgets can wire reactive config through
// and share Vue's reactive cache. Split out of useMatchesDossier so the
// composable file holds the bedrock refs and this one holds the
// config-driven queries; both close over the same narrowed records via
// the args passed in.
export function useDossierQueries(
  records: Readonly<Ref<MatchRecord[]>>,
  tallyRecords: ComputedRef<MatchRecord[]>,
  heroRole?: HeroRoleResolver,
  weekStart?: Readonly<Ref<WeekStart>>,
) {
  // Generic top-N-by-count query. The full record set drives the
  // breakdown (NOT tallyRecords) so a user filtering "exclude-tally"
  // for leavers still sees leaver-affected maps in the breakdown —
  // the per-cell winrate then reads pre-tally-exclusion. We can
  // reconsider that if a user reports it as confusing; for now the
  // simpler "everything counts here" rule wins.
  //
  // Drives the top-maps, top-heroes-by-count, and top-game-modes
  // widgets — each passes its own getter + limit. The widget's
  // useWidgetConfig output supplies `limit`; PR B callers hardcode
  // it to match today's behaviour.
  function topByCount(
    opts: MaybeRefOrGetter<{ getter: (r: MatchRecord) => string | undefined; limit: number }>,
  ): ComputedRef<BreakdownEntry[]> {
    return computed(() => {
      const { getter, limit } = toValue(opts)
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
    })
  }

  // Win rate by an arbitrary dimension (hero / map / role), ranked
  // best → worst. Only decisive matches count (draws excluded, as in
  // the headline winrate); `total` is the decisive sample behind each
  // rate and doubles as the `minMatches` qualification gate so a 100%
  // rate over one game doesn't top the list. Uses tallyRecords so the
  // leaver-handling preference is honoured. Drives the opt-in
  // win-rate-by-hero / -map / -role widgets — each passes its getter.
  function winrateBy(
    opts: MaybeRefOrGetter<{ getter: (r: MatchRecord) => string | undefined; minMatches: number; limit: number }>,
  ): ComputedRef<BreakdownEntry[]> {
    return computed(() => {
      const { getter, minMatches, limit } = toValue(opts)
      const buckets = new Map<string, { w: number; l: number }>()
      for (const r of tallyRecords.value) {
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
        .map(([key, { w, l }]) => {
          const total = w + l
          const winrate = Math.round((w / total) * 100)
          // share === winrate so the shared breakdown bar renders the
          // win-rate; the widgets read `winrate` directly regardless.
          return { key, total, winrate, share: winrate }
        })
        .filter((e) => e.total >= minMatches)
        .sort((a, b) => b.winrate - a.winrate || b.total - a.total)
        .slice(0, limit)
    })
  }

  // Count + win-rate per non-result modifier — the rank-update pills
  // (uphill battle, reversal, consolation, win/loss streak, calibration,
  // volatile, demotion protection). A match carries several modifiers, so
  // it counts toward each: the buckets overlap by design. Victory / defeat
  // / draw are excluded (they're the result, already the headline W/L/D).
  // Ranked by frequency. Drives the opt-in "Match modifiers" breakdown.
  function modifierBreakdown(
    opts: MaybeRefOrGetter<{ limit: number }>,
  ): ComputedRef<BreakdownEntry[]> {
    return computed(() => {
      const { limit } = toValue(opts)
      const counts = new Map<string, { total: number; w: number; l: number }>()
      for (const r of records.value) {
        const result = r.data?.result
        for (const modifier of r.data?.modifiers ?? []) {
          if (!modifier || RESULT_MODIFIERS.has(modifier)) continue
          const entry = counts.get(modifier) ?? { total: 0, w: 0, l: 0 }
          entry.total++
          if (result === 'victory') entry.w++
          else if (result === 'defeat') entry.l++
          counts.set(modifier, entry)
        }
      }
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
    })
  }

  // Count + win-rate for ONE modifier — drives the Uphill Battle / Reversal
  // KPI tiles ("how often do I clutch as the underdog / choke when
  // favoured"). Null when the modifier never appears in the set.
  function modifierRecord(
    opts: MaybeRefOrGetter<{ modifier: string }>,
  ): ComputedRef<ModifierRecord | null> {
    return computed(() => {
      const { modifier } = toValue(opts)
      let total = 0, w = 0, l = 0
      for (const r of records.value) {
        if (!(r.data?.modifiers ?? []).includes(modifier)) continue
        total++
        if (r.data?.result === 'victory') w++
        else if (r.data?.result === 'defeat') l++
      }
      if (total === 0) return null
      const decided = w + l
      return { total, winrate: decided === 0 ? null : Math.round((w / decided) * 100) }
    })
  }

  // Win rate by teammate — buckets the set by who you played WITH
  // (annotation.members), plus a "Solo" bucket for matches with no
  // teammates recorded. A match with members {A, B} counts toward BOTH
  // A and B (and never Solo), so the buckets overlap by design: the
  // question is "how do I do when X is on my team," answered per
  // teammate. Ranked by games-together so the people you grind with
  // most lead; `total` doubles as the sample-size guard (a 100% win
  // rate over one game is noise, over fifty is signal). Drives the
  // opt-in "Win rate by teammate" widget.
  function withWhomBreakdown(
    opts: MaybeRefOrGetter<{ limit: number }>,
  ): ComputedRef<BreakdownEntry[]> {
    return computed(() => {
      const { limit } = toValue(opts)
      const counts = new Map<string, { total: number; w: number; l: number }>()
      const bump = (key: string, r: MatchRecord) => {
        const e = counts.get(key) ?? { total: 0, w: 0, l: 0 }
        e.total++
        if (r.data?.result === 'victory') e.w++
        else if (r.data?.result === 'defeat') e.l++
        counts.set(key, e)
      }
      for (const r of records.value) {
        const members = (r.annotation?.members ?? []).filter(Boolean)
        if (members.length === 0) bump('Solo', r)
        else for (const m of members) bump(m, r)
      }
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
    })
  }

  // Mirrors the keys exposed by `pkg/parser/maps.yaml` — the
  // canonical 6 Overwatch game-mode slugs. Hardcoded so the heatmap
  // renders its column header row deterministically even on first
  // mount before `useOWData()` resolves; if the parser ever ships a
  // new game-mode, this list updates in lockstep with the YAML.
  const CANONICAL_GAME_MODES = ['control', 'escort', 'flashpoint', 'hybrid', 'push', 'clash'] as const

  // Hero × Map-type breakdown. Returns a flat list of
  // (hero, gameMode, wins, losses, draws, total) — the heatmap widget
  // pivots this into a 2-D grid (rows = heroes, columns = game modes).
  //
  // The game-mode vocabulary is the parser's canonical 6 (control /
  // escort / flashpoint / hybrid / push / clash). Records whose
  // type is missing or doesn't map to a canonical entry drop out —
  // the heatmap deliberately doesn't show an "unknown" column
  // because it would carry no actionable signal (you can't "play
  // unknown maps better").
  //
  // Records contribute multiple cells when their heroes_played[]
  // has multiple entries (open-queue match where the user
  // hero-swapped). Each hero in the list gets credit for the
  // result on that game mode — same model used by topByCount when
  // the getter pulls from heroes_played. Limit applies to the
  // hero axis (top-N by total play count); the game-mode axis is
  // always all 6.
  function heroGameModeCounts(
    opts?: MaybeRefOrGetter<{ heroLimit?: number; minMatches?: number; windowMonths?: number }>,
  ): ComputedRef<Array<{
    hero: string
    gameMode: string
    wins: number
    losses: number
    draws: number
    total: number
    winrate: number
  }>> {
    return computed(() => {
      const { heroLimit = 8, minMatches: _minMatches = 0, windowMonths = 0 } = opts ? toValue(opts) ?? {} : {}
      void _minMatches // reserved for future per-cell empty-state floor
      // `windowMonths` scopes the heatmap to a trailing time window (the
      // band's 1M/3M/6M/12M toggle) — records older than the cutoff, or
      // with no date, drop out. 0 (the default) means all-time.
      const cutoff = windowMonths > 0 ? monthsAgoISO(windowMonths) : ''
      type Bucket = { wins: number; losses: number; draws: number; total: number }
      const cells = new Map<string, Bucket>()
      const heroTotals = new Map<string, number>()
      function cellKey(h: string, t: string) { return `${h}\0${t}` }
      function bumpCell(h: string, t: string, r: MatchRecord) {
        const k = cellKey(h, t)
        const b = cells.get(k) ?? { wins: 0, losses: 0, draws: 0, total: 0 }
        b.total++
        if      (r.data?.result === 'victory') b.wins++
        else if (r.data?.result === 'defeat')  b.losses++
        else if (r.data?.result === 'draw')    b.draws++
        cells.set(k, b)
        heroTotals.set(h, (heroTotals.get(h) ?? 0) + 1)
      }
      for (const r of records.value) {
        const gameMode = r.data?.game_mode
        if (!gameMode) continue
        if (cutoff) {
          const d = r.data?.date
          if (!d || d < cutoff) continue
        }
        const heroes = r.data?.heroes_played ?? []
        if (heroes.length > 0) {
          const seenInRow = new Set<string>()
          for (const hp of heroes) {
            if (!hp.hero || seenInRow.has(hp.hero)) continue
            seenInRow.add(hp.hero)
            bumpCell(hp.hero, gameMode, r)
          }
        } else if (r.data?.hero) {
          bumpCell(r.data.hero, gameMode, r)
        }
      }
      // Pick the top heroes by total appearances; the heatmap only
      // shows that subset to keep the grid scannable on viewport.
      const topHeroes = [...heroTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, heroLimit)
        .map(([h]) => h)
        // Pick the most-played for scannability, then display A→Z so the
        // rows read as a stable alphabetical list (matching the columns).
        .sort((a, b) => a.localeCompare(b))
      // Materialise every (top-hero, game-mode) cell — including
      // zeros — so the grid layout is rectangular. The widget
      // renders the empty cells as a flat surface tone (no border,
      // no glyph) so the eye reads the populated cells first.
      const out: Array<{ hero: string; gameMode: string; wins: number; losses: number; draws: number; total: number; winrate: number }> = []
      // Columns A→Z too — sort a copy so the canonical-order constant
      // stays intact for any other consumer.
      const orderedModes = [...CANONICAL_GAME_MODES].sort((a, b) => a.localeCompare(b))
      for (const h of topHeroes) {
        for (const t of orderedModes) {
          const b = cells.get(cellKey(h, t)) ?? { wins: 0, losses: 0, draws: 0, total: 0 }
          const decided = b.wins + b.losses
          out.push({
            hero: h,
            gameMode: t,
            wins:   b.wins,
            losses: b.losses,
            draws:  b.draws,
            total:  b.total,
            winrate: decided === 0 ? 0 : Math.round((b.wins / decided) * 100),
          })
        }
      }
      return out
    })
  }

  // Top heroes by SUMMED play time across every heroes_played[]
  // entry — not by primary-hero match count. The dossier's bar
  // visualization then reads "what hero did you spend the most time
  // on" rather than "what hero did you click first most often."
  // Default limit is 3 (vs topByCount widgets' typical 5) because
  // the time-based row carries a longer label ("7h32min") that needs
  // room to breathe in the breakdown grid. Records whose
  // heroes_played[] is missing or whose entries lack a parseable
  // play_time contribute nothing.
  function topHeroesByMinutes(
    opts: MaybeRefOrGetter<{ limit: number }>,
  ): ComputedRef<HeroBreakdownEntry[]> {
    return computed(() => {
      const { limit } = toValue(opts)
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
        .slice(0, limit)
        .map(([key, b]) => ({
          key,
          totalMinutes: b.minutes,
          share: totalMinutes === 0 ? 0 : Math.round((b.minutes / totalMinutes) * 100),
          winrate: b.w + b.l === 0 ? 0 : Math.round((b.w / (b.w + b.l)) * 100),
          timeLabel: formatPlayMinutes(b.minutes),
        }))
    })
  }

  // Win-rate annotation for the Most-played-hero KPI tile. Sources
  // the hero name from topHeroesByMinutes[0] (time-ranked) and the
  // W/L counts from records where that hero's percent_played cleared
  // the `minPercentPlayed` threshold. Draws skip both buckets (same
  // rule as the headline winrate). Null winrate when no qualifying
  // decisive matches exist — caller renders the hero name without
  // a percentage in that case.
  //
  // Default threshold matches DEFAULT_MOST_PLAYED_HERO_THRESHOLD
  // so a 20%+ play attribution counts toward the winrate without
  // the user having to opt in. The widget's config exposes 10/15/
  // 20/25/30% choices in PR C.
  function mostPlayedHero(
    opts: MaybeRefOrGetter<{ minPercentPlayed: number }>,
  ): ComputedRef<MostPlayedHero | null> {
    // Captured top-hero ref so the query is reactive over both the
    // headline hero pick AND the threshold knob. limit=1 — we only
    // need the leader.
    const topRef = topHeroesByMinutes({ limit: 1 })
    return computed(() => {
      const { minPercentPlayed } = toValue(opts)
      const top = topRef.value[0]
      if (!top) return null
      let w = 0, l = 0
      for (const r of tallyRecords.value) {
        const played = (r.data?.heroes_played ?? []).find((hp) => hp.hero === top.key)
        if (!played) continue
        if ((played.percent_played ?? 0) < minPercentPlayed) continue
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
  }

  // Map × Role performance — the data behind the Geography band.
  // Symmetric with topRoles' overlap-aware role model, but keyed by
  // (specific map × role) instead of role alone. Each match credits
  // every role it touched (primary data.role + each heroes_played
  // hero's role via the resolver), deduped per match, on that match's
  // map. Records without a map drop out (no actionable column). Emits
  // only populated cells; the band joins them against the full map
  // roster from useOWData and renders the gaps as empty cells.
  //
  // `windowMonths` scopes the aggregate to a trailing time window
  // (the band's 1M/3M/6M/12M toggle, mirroring the Campaign Log) —
  // records older than the cutoff, OR with no date, drop out. 0 (the
  // default) means all-time.
  function mapRoleCounts(
    opts?: MaybeRefOrGetter<{ windowMonths?: number }>,
  ): ComputedRef<MapRoleCell[]> {
    return computed(() => {
    const { windowMonths = 0 } = opts ? toValue(opts) ?? {} : {}
    const cutoff = windowMonths > 0 ? monthsAgoISO(windowMonths) : ''
    type Bucket = { wins: number; losses: number; draws: number; total: number }
    const cells = new Map<string, Bucket>()
    for (const r of records.value) {
      const map = r.data?.map
      if (!map) continue
      if (cutoff) {
        const d = r.data?.date
        if (!d || d < cutoff) continue
      }
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
        const key = `${map}|${role}`
        const b = cells.get(key) ?? { wins: 0, losses: 0, draws: 0, total: 0 }
        b.total++
        if      (r.data?.result === 'victory') b.wins++
        else if (r.data?.result === 'defeat')  b.losses++
        else if (r.data?.result === 'draw')    b.draws++
        cells.set(key, b)
      }
    }
    const out: MapRoleCell[] = []
    for (const [key, b] of cells) {
      const sep = key.lastIndexOf('|')
      const decided = b.wins + b.losses
      out.push({
        map:   key.slice(0, sep),
        role:  key.slice(sep + 1) as MapRoleCell['role'],
        wins:   b.wins,
        losses: b.losses,
        draws:  b.draws,
        total:  b.total,
        winrate: decided === 0 ? 0 : Math.round((b.wins / decided) * 100),
      })
    }
    return out
    })
  }

  // Per-map tally over the (narrowed) set — the Hero × Game-Mode band's
  // drill-down "maps" level reads this once the active set is already
  // pinned to a hero + game-mode, so a flat by-map count is all it
  // needs. `windowMonths` scopes to a trailing window like mapRoleCounts.
  function mapCounts(
    opts?: MaybeRefOrGetter<{ windowMonths?: number }>,
  ): ComputedRef<Array<{ map: string; wins: number; losses: number; draws: number; total: number; winrate: number }>> {
    return computed(() => {
      const { windowMonths = 0 } = opts ? toValue(opts) ?? {} : {}
      const cutoff = windowMonths > 0 ? monthsAgoISO(windowMonths) : ''
      type Bucket = { wins: number; losses: number; draws: number; total: number }
      const cells = new Map<string, Bucket>()
      for (const r of records.value) {
        const map = r.data?.map
        if (!map) continue
        if (cutoff) {
          const d = r.data?.date
          if (!d || d < cutoff) continue
        }
        const b = cells.get(map) ?? { wins: 0, losses: 0, draws: 0, total: 0 }
        b.total++
        if      (r.data?.result === 'victory') b.wins++
        else if (r.data?.result === 'defeat')  b.losses++
        else if (r.data?.result === 'draw')    b.draws++
        cells.set(map, b)
      }
      const out: Array<{ map: string; wins: number; losses: number; draws: number; total: number; winrate: number }> = []
      for (const [map, b] of cells) {
        const decided = b.wins + b.losses
        out.push({
          map,
          wins:   b.wins,
          losses: b.losses,
          draws:  b.draws,
          total:  b.total,
          winrate: decided === 0 ? 0 : Math.round((b.wins / decided) * 100),
        })
      }
      return out
    })
  }

  // Recent individual matches over the (narrowed) set — the band's
  // deepest drill level (a specific hero × mode × map) shows the games
  // that produced it, newest-PLAYED first (date + finished_at, falling
  // back to parsed_at), capped to `count` (default 8). `windowMonths`
  // scopes to a trailing window.
  function recentMatches(
    opts?: MaybeRefOrGetter<{ count?: number; windowMonths?: number }>,
  ): ComputedRef<Array<{ matchKey: string; date: string; finishedAt: string; result: string; map: string }>> {
    return computed(() => {
      const { count = 8, windowMonths = 0 } = opts ? toValue(opts) ?? {} : {}
      const cutoff = windowMonths > 0 ? monthsAgoISO(windowMonths) : ''
      const playedKey = (r: MatchRecord) =>
        `${r.data?.date ?? ''}T${r.data?.finished_at ?? ''}` || (r.parsed_at ?? '')
      return records.value
        .filter((r) => {
          if (!cutoff) return true
          const d = r.data?.date
          return !!d && d >= cutoff
        })
        .slice()
        .sort((a, b) => playedKey(b).localeCompare(playedKey(a)))
        .slice(0, count)
        .map((r) => ({
          matchKey:   r.match_key,
          date:       r.data?.date ?? '',
          finishedAt: r.data?.finished_at ?? '',
          result:     r.data?.result ?? '',
          map:        r.data?.map ?? '',
        }))
    })
  }

  // Best hero by winrate, gated to ≥ `minPercentPlayed` percent
  // play AND ≥ `minMatches` decisive qualifying matches. Ties
  // broken by qualifyingMatches desc (more sample = better signal).
  // Null when no hero clears both gates.
  //
  // Two knobs: PR C's widget config lets the user move either gate
  // independently. The defaults match the long-standing
  // MOST_PLAYED_HERO_THRESHOLD (20%) + BEST_WINRATE_HERO_MIN_MATCHES
  // (3) constants exactly so first-hydrate is a no-op.
  function bestWinrateHero(
    opts: MaybeRefOrGetter<{ minPercentPlayed: number; minMatches: number }>,
  ): ComputedRef<BestWinrateHero | null> {
    return computed(() => {
      const { minPercentPlayed, minMatches } = toValue(opts)
      const buckets = new Map<string, { w: number; l: number }>()
      for (const r of tallyRecords.value) {
        const result = r.data?.result
        if (result !== 'victory' && result !== 'defeat') continue
        for (const hp of r.data?.heroes_played ?? []) {
          if (!hp.hero) continue
          if ((hp.percent_played ?? 0) < minPercentPlayed) continue
          const bucket = buckets.get(hp.hero) ?? { w: 0, l: 0 }
          if (result === 'victory') bucket.w++
          else bucket.l++
          buckets.set(hp.hero, bucket)
        }
      }
      let best: BestWinrateHero | null = null
      for (const [hero, { w, l }] of buckets) {
        const qualifying = w + l
        if (qualifying < minMatches) continue
        const winrate = Math.round((w / qualifying) * 100)
        if (best === null
          || winrate > best.winrate
          || (winrate === best.winrate && qualifying > best.qualifyingMatches)) {
          best = { key: hero, winrate, qualifyingMatches: qualifying }
        }
      }
      return best
    })
  }

  // Time-of-day distribution — parameterizable bucket count over
  // the `data.finished_at` HH:MM string. 6 buckets (4-hour windows)
  // is the historical default; PR C exposes 12 (2-hour) and 24
  // (1-hour) choices. Records without a parseable hour skipped;
  // share denominator = records WITH a parseable hour so the
  // percentages reflect the workflow-relevant fraction of the narrow.
  function timeOfDayBuckets(
    opts: MaybeRefOrGetter<{ bucketCount: 6 | 12 | 24 }>,
  ): ComputedRef<BucketEntry[]> {
    return computed(() => {
      const { bucketCount } = toValue(opts)
      const hoursPerBucket = 24 / bucketCount
      const counts = new Array<number>(bucketCount).fill(0)
      let denom = 0
      for (const r of records.value) {
        const fa = r.data?.finished_at
        if (!fa || fa.length < 2) continue
        const hour = Number.parseInt(fa.slice(0, 2), 10)
        if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue
        const bucket = Math.floor(hour / hoursPerBucket)
        counts[bucket]!++
        denom++
      }
      return makeTimeOfDayLabels(bucketCount).map((label, i) => ({
        label,
        count: counts[i]!,
        share: denom === 0 ? 0 : Math.round((counts[i]! / denom) * 100),
      }))
    })
  }

  // Day-of-week distribution — seven buckets rotated to respect the
  // user's useWeekStart setting (Sun=0 .. Sat=6) OR a per-widget
  // override passed via opts.weekStartOverride. The override exists
  // so power users can pin one widget to a different week start than
  // the global preference (e.g. comparing a Monday-anchored scrim
  // week against the rest of the dossier's Sunday calendar).
  // Records without a parseable `data.date` skipped; share
  // denominator = records WITH a parseable day.
  function dayOfWeekBuckets(
    opts: MaybeRefOrGetter<{ weekStartOverride?: WeekStart }> = { weekStartOverride: undefined },
  ): ComputedRef<BucketEntry[]> {
    return computed(() => {
      const { weekStartOverride } = toValue(opts)
      const counts = [0, 0, 0, 0, 0, 0, 0]
      let denom = 0
      for (const r of records.value) {
        const date = r.data?.date
        if (!date) continue
        // Parse with explicit Z so getUTCDay() reads the user-meaningful
        // date regardless of the local timezone the browser runs in —
        // otherwise a 2026-05-10 record reads as Saturday in
        // UTC-negative timezones and Sunday in UTC-leaning ones.
        const d = new Date(date + 'T00:00:00Z')
        const day = d.getUTCDay()
        if (!Number.isFinite(day) || day < 0 || day > 6) continue
        counts[day]!++
        denom++
      }
      const start = weekStartOverride ?? weekStart?.value ?? 0
      const rotated: BucketEntry[] = []
      for (let i = 0; i < 7; i++) {
        const srcIdx = (start + i) % 7
        rotated.push({
          label: DAY_OF_WEEK_LABELS[srcIdx]!,
          count: counts[srcIdx]!,
          share: denom === 0 ? 0 : Math.round((counts[srcIdx]! / denom) * 100),
        })
      }
      return rotated
    })
  }

  // Recent results — last N decisive (W / L / D) results in
  // newest-first order. The widget renders these as small coloured
  // pills so the user reads "I just won, lost, lost, won, won" at
  // a glance. PR C's config lets the user pick 3 / 5 / 10.
  function recentResults(
    opts: MaybeRefOrGetter<{ count: number }>,
  ): ComputedRef<('victory' | 'defeat' | 'draw')[]> {
    return computed(() => {
      const { count } = toValue(opts)
      return tallyRecords.value
        .slice()
        .sort((a, b) => (b.parsed_at ?? '').localeCompare(a.parsed_at ?? ''))
        .map((r) => r.data?.result)
        .filter((r): r is 'victory' | 'defeat' | 'draw' =>
          r === 'victory' || r === 'defeat' || r === 'draw')
        .slice(0, count)
    })
  }

  return {
    topByCount,
    winrateBy,
    modifierBreakdown,
    modifierRecord,
    withWhomBreakdown,
    heroGameModeCounts,
    mapRoleCounts,
    mapCounts,
    recentMatches,
    topHeroesByMinutes,
    mostPlayedHero,
    bestWinrateHero,
    timeOfDayBuckets,
    dayOfWeekBuckets,
    recentResults,
  }
}
