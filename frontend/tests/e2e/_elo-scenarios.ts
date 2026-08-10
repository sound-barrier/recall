// Thirty deterministic competitive histories for the Elo Calculator capture
// harness (elo-scenarios.spec.ts). Each scenario compiles to the canonical
// /api/v1/matches row shape (see elo-statistics.spec.ts) with relative dates
// only — never toISOString — so pace/season windows stay stable day to day.
//
// The grid spans starting ranks Bronze 5 → Diamond 3, 1 → 200 games, 30–65%
// win rates, draws, streak-ordered and alternating records, thin/rich/
// asymmetric meter pools, missing rank cards, tilt sittings, layoff gaps,
// and a mid-corpus form break. s02 pins the "1W–2L must never read as
// Capped" regression; s29/s30 pin the pooled-n cap and nudge isolation.

export type Res = 'victory' | 'defeat' | 'draw'

export interface Game {
  r: Res
  day: number // date offset from today (negative = past)
  time: string // HH:MM local
  tier?: string
  level?: number
  progress?: number
  cp?: number // change_percent; omitted when undefined
  streak?: 'win streak' | 'loss streak'
  hero?: string
  extraHeroes?: string[] // additional meaningfully-played heroes (multi-hero credit)
}

export interface ScenarioSpec {
  id: string
  note: string
  games: Game[]
  interact?: 'pick-two-heroes' | 'nudge-lucio-plus-3'
}

type Order = 'spread' | 'streaky' | 'alternating' | 'firstHalfHot'

interface SeqOpts {
  wins: number
  losses: number
  draws?: number
  order?: Order
  tier?: string // omit for no rank cards at all
  level?: number
  meter?: 'rich' | 'thin5' | 'none' | { win: number; loss: number }
  climb?: boolean // two-band level walk (slope-bearing), mirrors the canonical corpus
  daysSpan?: number // squeeze all games into the trailing N days (default 1/day)
  gapAfter?: { index: number; days: number } // insert a layoff gap
  hero?: string
}

// Deterministic result order without Math.random: 'spread' distributes wins
// evenly (Bresenham), 'streaky' groups runs of 5, 'alternating' strictly
// interleaves, 'firstHalfHot' front-loads wins (the change-point shape).
function resultOrder(wins: number, losses: number, order: Order): Res[] {
  const n = wins + losses
  const out: Res[] = []
  if (order === 'streaky') {
    let w = wins
    let l = losses
    let onWins = true
    while (w + l > 0) {
      const take = onWins ? Math.min(5, w) : Math.min(5, l)
      for (let i = 0; i < take; i++) out.push(onWins ? 'victory' : 'defeat')
      if (onWins) w -= take
      else l -= take
      onWins = !onWins
      if (onWins && w === 0) onWins = false
      if (!onWins && l === 0) onWins = true
    }
    return out
  }
  if (order === 'alternating') {
    let w = wins
    let l = losses
    while (w + l > 0) {
      if (w > 0 && (l === 0 || (out.length % 2 === 0))) {
        out.push('victory')
        w--
      } else if (l > 0) {
        out.push('defeat')
        l--
      }
    }
    return out
  }
  if (order === 'firstHalfHot') {
    // First half at 80% wins, second half at 40% — the form-break corpus.
    const half = Math.floor(n / 2)
    const firstW = Math.min(wins, Math.round(half * 0.8))
    const first = resultOrder(firstW, half - firstW, 'spread')
    const second = resultOrder(wins - firstW, losses - (half - firstW), 'spread')
    return [...first, ...second]
  }
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += wins
    if (acc >= n) {
      acc -= n
      out.push('victory')
    } else {
      out.push('defeat')
    }
  }
  return out
}

function interleaveDraws(results: Res[], draws: number): Res[] {
  if (draws <= 0) return results
  const out = [...results]
  const gap = Math.max(1, Math.floor(out.length / draws))
  for (let i = 0; i < draws; i++) out.splice(Math.min(out.length, (i + 1) * gap + i), 0, 'draw')
  return out
}

// seq compiles knobs into a chronological game list (oldest first).
// A run of ≥2 like decisive results wears the matching streak modifier.
function streakLabel(r: Res, runLen: number): Game['streak'] {
  if (runLen < 2 || r === 'draw') return undefined
  return r === 'victory' ? 'win streak' : 'loss streak'
}

export function seq(o: SeqOpts): Game[] {
  const results = interleaveDraws(resultOrder(o.wins, o.losses, o.order ?? 'spread'), o.draws ?? 0)
  const n = results.length
  const meter = o.meter ?? 'rich'
  const games: Game[] = []
  let runLen = 0
  let prev: Res | null = null
  for (let i = 0; i < n; i++) {
    const r = results[i]!
    runLen = r !== 'draw' && r === prev ? runLen + 1 : 1
    prev = r
    const streak = streakLabel(r, runLen)

    let cp: number | undefined
    if (r !== 'draw') {
      if (meter === 'rich') cp = (r === 'victory' ? 1 : -1) * (streak ? 30 : 20)
      else if (meter === 'thin5') { if (i < 5) cp = r === 'victory' ? 20 : -20 }
      else if (meter === 'none') cp = undefined
      else cp = r === 'victory' ? meter.win : meter.loss
    }

    let level = o.level
    if (o.climb && o.tier && o.level !== undefined) {
      // Two-band walk: older half one division lower, mirroring the
      // canonical slope-bearing corpus.
      level = i < n / 2 ? Math.min(5, o.level + 1) : o.level
    }

    let day: number
    if (o.daysSpan !== undefined) {
      day = -o.daysSpan + Math.floor((i * o.daysSpan) / n)
    } else {
      day = -(n - i)
    }
    if (o.gapAfter && i > o.gapAfter.index) day -= 0 // gap applied below via base shift
    games.push({
      r,
      day,
      time: `12:${String((i * 7) % 60).padStart(2, '0')}`,
      ...(o.tier ? { tier: o.tier, level, progress: (i * 7) % 100 } : {}),
      ...(cp !== undefined ? { cp } : {}),
      ...(streak ? { streak } : {}),
      ...(o.hero ? { hero: o.hero } : {}),
    })
  }
  if (o.gapAfter) {
    const g = o.gapAfter
    for (let i = 0; i <= g.index && i < games.length; i++) games[i]!.day -= g.days
  }
  return games
}

// sitting appends a same-evening loss run (hourly games) — the tilt fixture.
export function sitting(losses: number, day: number): Game[] {
  return Array.from({ length: losses }, (_, i) => ({
    r: 'defeat' as const,
    day,
    time: `${String(18 + Math.floor(i / 2))}:${i % 2 === 0 ? '05' : '35'}`,
    tier: 'gold',
    level: 3,
    progress: 50,
    cp: -20,
    ...(i >= 1 ? { streak: 'loss streak' as const } : {}),
  }))
}

export const SCENARIOS: ScenarioSpec[] = [
  { id: 's01', note: '1 game, floor of the floor', games: seq({ wins: 1, losses: 0, tier: 'bronze', level: 5 }) },
  { id: 's02', note: 'THE regression: 1W-2L must be Early read, never Capped', games: seq({ wins: 1, losses: 2, tier: 'bronze', level: 5 }) },
  { id: 's03', note: 'thin meter pools (<8/side)', games: seq({ wins: 3, losses: 5, tier: 'bronze', level: 3, meter: 'thin5' }) },
  { id: 's04', note: 'no rank cards at all', games: seq({ wins: 7, losses: 5, meter: 'none' }) },
  { id: 's05', note: 'n=19, one under the provisional floor', games: seq({ wins: 10, losses: 9, tier: 'gold', level: 3 }) },
  { id: 's06', note: 'n=20, exactly at the floor', games: seq({ wins: 11, losses: 9, tier: 'gold', level: 3 }) },
  { id: 's07', note: 'n=21, just over the floor', games: seq({ wins: 11, losses: 10, tier: 'gold', level: 3 }) },
  { id: 's08', note: 'underranked 65% over 40', games: seq({ wins: 26, losses: 14, tier: 'gold', level: 1, climb: true }) },
  { id: 's09', note: 'canonical 55% slope-bearing baseline', games: seq({ wins: 33, losses: 27, tier: 'gold', level: 3, climb: true }) },
  { id: 's10', note: 'capped 45% with a full sample', games: seq({ wins: 27, losses: 33, tier: 'gold', level: 3 }) },
  { id: 's11', note: 'coin-flip 50% at Plat 5', games: seq({ wins: 30, losses: 30, tier: 'platinum', level: 5 }) },
  { id: 's12', note: '200 games, 52% — measured well', games: seq({ wins: 104, losses: 96, tier: 'platinum', level: 2 }) },
  { id: 's13', note: 'high rank, 60% over 200', games: seq({ wins: 120, losses: 80, tier: 'diamond', level: 3 }) },
  { id: 's14', note: 'deep dip: 30% over 200', games: seq({ wins: 60, losses: 140, tier: 'gold', level: 3 }) },
  { id: 's15', note: 'streak-ordered record (runs test: streakier)', games: seq({ wins: 39, losses: 21, tier: 'gold', level: 3, order: 'streaky' }) },
  { id: 's16', note: 'perfectly alternating (runs test: more alternating)', games: seq({ wins: 30, losses: 30, tier: 'gold', level: 3, order: 'alternating' }) },
  { id: 's17', note: '20 draws excluded from the decisive sample', games: seq({ wins: 24, losses: 16, draws: 20, tier: 'gold', level: 3 }) },
  { id: 's18', note: 'meter on only 5 of 60 games', games: seq({ wins: 33, losses: 27, tier: 'gold', level: 3, meter: 'thin5' }) },
  { id: 's19', note: 'asymmetric meter +15/-25', games: seq({ wins: 33, losses: 27, tier: 'gold', level: 3, meter: { win: 15, loss: -25 } }) },
  { id: 's20', note: 'steep measured slope: hot low band, cold high band', games: [...seq({ wins: 21, losses: 9, tier: 'silver', level: 2 }).map((g, i) => ({ ...g, day: g.day - 30, progress: (i * 3) % 100 })), ...seq({ wins: 15, losses: 15, tier: 'silver', level: 1 })] },
  { id: 's21', note: 'no rank fields anywhere, 50%', games: seq({ wins: 30, losses: 30, meter: 'none' }) },
  { id: 's22', note: 'ladder floor clamp at Bronze 5, 30%', games: seq({ wins: 18, losses: 42, tier: 'bronze', level: 5 }) },
  { id: 's23', note: 'near-top: Diamond 3 defaults target Master 5', games: seq({ wins: 39, losses: 21, tier: 'diamond', level: 3 }) },
  { id: 's24', note: 'tilt sitting: 7 losses one evening', games: [...seq({ wins: 21, losses: 5, tier: 'gold', level: 3 }), ...sitting(7, -1)] },
  { id: 's25', note: '12-day layoff mid-corpus (rust)', games: seq({ wins: 33, losses: 27, tier: 'gold', level: 3, gapAfter: { index: 29, days: 12 } }) },
  { id: 's26', note: 'form break: 80% then 40%', games: seq({ wins: 48, losses: 32, tier: 'gold', level: 3, order: 'firstHalfHot' }) },
  { id: 's27', note: 'low-n capped-adjacent boundary (12-8)', games: seq({ wins: 12, losses: 8, tier: 'gold', level: 5 }) },
  { id: 's28', note: 'pace extreme: 60 games in 3 days', games: seq({ wins: 33, losses: 27, tier: 'platinum', level: 5, daysSpan: 3 }) },
  { id: 's29', note: 'pooled-n cap: multi-hero credit, both heroes selected', interact: 'pick-two-heroes', games: seq({ wins: 33, losses: 27, tier: 'gold', level: 3, climb: true }).map((g, i) => (i % 2 === 0 ? { ...g, extraHeroes: ['ana'] } : g)) },
  { id: 's30', note: 'nudge isolation: stats must match s09, projections differ', interact: 'nudge-lucio-plus-3', games: seq({ wins: 33, losses: 27, tier: 'gold', level: 3, climb: true }) },
]

// buildRows compiles a scenario to the wire shape the page consumes.
export function buildRows(spec: ScenarioSpec, localYMD: (offset: number) => string): unknown[] {
  return spec.games.map((g, idx) => {
    const seqNo = spec.games.length - idx
    const ymd = localYMD(g.day)
    const utc = `${ymd}T${g.time}:00Z`
    const hero = g.hero ?? 'lucio'
    const played = [{ hero, percent_played: g.extraHeroes ? 60 : 100, play_time: '10:00' },
      ...(g.extraHeroes ?? []).map((h) => ({ hero: h, percent_played: 40, play_time: '04:00' }))]
    const modifiers = g.r === 'draw' ? ['draw'] : [g.r, ...(g.streak ? [g.streak] : [])]
    return {
      match_key: `${spec.id}-m${seqNo}`,
      source_files: [`${spec.id}-${seqNo}.png`],
      parsed_at: utc,
      queue_type: 'role',
      data: {
        map: 'ilios',
        playlist: 'competitive',
        hero,
        role: 'support',
        result: g.r,
        date: ymd,
        finished_at: g.time,
        played_at_utc: utc,
        game_length: '10:00',
        heroes_played: played,
        ...(g.tier ? { rank: g.tier, level: g.level, rank_progress: g.progress ?? 0 } : {}),
        ...(g.cp !== undefined ? { change_percent: g.cp, modifiers } : { modifiers }),
      },
    }
  })
}
