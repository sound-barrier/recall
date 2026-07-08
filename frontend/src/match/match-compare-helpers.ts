import { LOW_SAMPLE_N, wilsonMargin } from '@/match/match-sample-helpers'
import type { HeroStat, ModeStat } from '@/match/match-compare-aggregate'

// Season-vs-season comparison: pure row-building from two metric snapshots so
// the delta/direction/low-sample logic is unit-testable independently of the
// dossier composables that source the numbers. The view extracts a SeasonMetrics
// snapshot off each season's dossier + record slice, then compareSeasons() turns
// the pair into labelled sections of display rows. Direction is framed "B
// relative to A" — season B (typically the newer pick) improving on season A
// reads as ▲, so the table answers "am I doing better this season than last?".

// A win-rate + games pair (a role or a game mode). games 0 → not played.
export interface RateStat {
  winrate: number
  games: number
}

export interface SeasonMetrics {
  // Overview
  games: number // decisive + draws (wld.total)
  wins: number
  losses: number
  draws: number
  competitiveGames: number
  quickPlayGames: number
  roleQueueGames: number
  openQueueGames: number
  winratePct: number | null // integer percent, draws excluded; null when no decisive match
  // Combat
  elimsPer10: number | null
  deathsPer10: number | null
  assistsPer10: number | null
  // Consistency
  minutesPlayed: number
  timeLabel: string // pre-formatted play-time, e.g. "7h32min" or "—"
  longestWinStreak: number
  longestLosingStreak: number
  // Roles
  roleTank: RateStat
  roleDps: RateStat
  roleSupport: RateStat
  heroPoolTank: number
  heroPoolDps: number
  heroPoolSupport: number
  bestHeroTank: HeroStat | null
  bestHeroDps: HeroStat | null
  bestHeroSupport: HeroStat | null
  // Maps
  topMap: string | null
  modes: ModeStat[]
  // Heroes
  topHero: string | null // already display-resolved; null when none
  worstHero: HeroStat | null
}

type RowOutcome = 'improved' | 'regressed' | 'even' | 'neutral' | null

export interface ComparisonRow {
  key: string
  label: string
  aDisplay: string
  bDisplay: string
  // "▲ 7 pts" | "▼ 1.2" | "+2" | "even" | null. ▲ always means "B is better",
  // regardless of whether the metric is higher- or lower-better; colour follows
  // `outcome`, so a lower death rate reads as a green ▲.
  delta: string | null
  outcome: RowOutcome
  // Winrate row only: either column has fewer than LOW_SAMPLE_N decisive matches,
  // so the rate (and its delta) is statistically noisy and should be caveated.
  lowSample: boolean
}

export interface ComparisonSection {
  title: string
  rows: ComparisonRow[]
}

// ─── Row builders ─────────────────────────────────────────────────────────

type Direction = 'higher-better' | 'lower-better' | 'neutral'

function judged(dir: Direction, a: number, b: number): RowOutcome {
  if (dir === 'neutral') return 'neutral'
  if (a === b) return 'even'
  const bIsBetter = dir === 'higher-better' ? b > a : b < a
  return bIsBetter ? 'improved' : 'regressed'
}

function deltaText(outcome: RowOutcome, magnitude: string, signed: string): string | null {
  switch (outcome) {
    case 'improved': return `▲ ${magnitude}`
    case 'regressed': return `▼ ${magnitude}`
    case 'even': return 'even'
    case 'neutral': return signed
    default: return null
  }
}

// numericRow builds a row for a metric where both columns are plain numbers (or
// null when a season has no qualifying data). `fmt` renders a value for display;
// `fmtDelta` renders the magnitude of the change. `quantize` snaps each value to
// the DISPLAY precision BEFORE the verdict + magnitude are computed, so the
// arrow, winner highlight, and delta never contradict the rendered columns
// (e.g. 18.42 vs 18.44 both show "18.4" → read as even, not "▲ 0.0").
function numericRow(opts: {
  key: string
  label: string
  dir: Direction
  a: number | null
  b: number | null
  fmt: (n: number) => string
  fmtDelta?: (n: number) => string
  quantize?: (n: number) => number
}): ComparisonRow {
  const { key, label, dir } = opts
  const fmt = opts.fmt
  const fmtDelta = opts.fmtDelta ?? ((n: number) => String(n))
  const quantize = opts.quantize ?? ((n: number) => n)
  const a = opts.a == null ? null : quantize(opts.a)
  const b = opts.b == null ? null : quantize(opts.b)
  const aDisplay = a == null ? '—' : fmt(a)
  const bDisplay = b == null ? '—' : fmt(b)
  if (a == null || b == null) {
    return { key, label, aDisplay, bDisplay, delta: null, outcome: null, lowSample: false }
  }
  const outcome = judged(dir, a, b)
  const magnitude = fmtDelta(Math.abs(b - a))
  const delta = deltaText(outcome, magnitude, dir === 'neutral' ? signedDelta(a, b, fmtDelta) : magnitude)
  return { key, label, aDisplay, bDisplay, delta, outcome, lowSample: false }
}

function signedDelta(a: number, b: number, fmtDelta: (n: number) => string): string {
  const raw = b - a
  // Format the zero case through fmtDelta too, so a unit-bearing delta (e.g.
  // "0 min") keeps its unit instead of dropping to a bare "0".
  if (raw === 0) return fmtDelta(0)
  const sign = raw > 0 ? '+' : '−'
  return `${sign}${fmtDelta(Math.abs(raw))}`
}

function intRow(key: string, label: string, dir: Direction, a: number, b: number): ComparisonRow {
  return numericRow({ key, label, dir, a, b, fmt: (n) => String(n), fmtDelta: (n) => String(n) })
}

function displayRow(key: string, label: string, a: string | null, b: string | null): ComparisonRow {
  return {
    key, label,
    aDisplay: a ?? '—',
    bDisplay: b ?? '—',
    delta: null, outcome: null, lowSample: false,
  }
}

// rateRow renders a win-rate + games pair ("58% · 12g") for a role or a game
// mode; "—" when unplayed in a column, and a higher-better win-rate delta (in
// percentage points) only when both columns were played.
function rateRow(key: string, label: string, a: RateStat, b: RateStat): ComparisonRow {
  const aPlayed = a.games > 0
  const bPlayed = b.games > 0
  const aDisplay = aPlayed ? `${a.winrate}% · ${a.games}g` : '—'
  const bDisplay = bPlayed ? `${b.winrate}% · ${b.games}g` : '—'
  if (!aPlayed || !bPlayed) {
    return { key, label, aDisplay, bDisplay, delta: null, outcome: null, lowSample: false }
  }
  const outcome = judged('higher-better', a.winrate, b.winrate)
  const magnitude = `${Math.abs(b.winrate - a.winrate)} pts`
  return { key, label, aDisplay, bDisplay, delta: deltaText(outcome, magnitude, magnitude), outcome, lowSample: false }
}

// heroStatRow renders "Genji · 62% · 8g" per column — no verdict, since the two
// seasons' heroes are usually different heroes, so their rates aren't a delta.
function heroStatRow(key: string, label: string, a: HeroStat | null, b: HeroStat | null): ComparisonRow {
  return displayRow(key, label, heroStatText(a), heroStatText(b))
}

function heroStatText(h: HeroStat | null): string | null {
  return h ? `${h.hero} · ${h.winrate}% · ${h.games}g` : null
}

// winrateRow renders each column as "62% ±8 · n=14" (raw rate + Wilson 95% margin
// + decisive-match count), flags the row low-sample when either side is thin, and
// judges the delta in percentage points.
function winrateRow(a: SeasonMetrics, b: SeasonMetrics): ComparisonRow {
  // Only caveat a column that actually shows a rate — a season with no decisive
  // matches renders '—', not a noisy percentage, so it shouldn't be flagged n<5.
  const lowSample =
    (a.winratePct != null && decisiveOf(a) < LOW_SAMPLE_N) ||
    (b.winratePct != null && decisiveOf(b) < LOW_SAMPLE_N)
  const row = numericRow({
    key: 'winrate',
    label: 'Win rate',
    dir: 'higher-better',
    a: a.winratePct,
    b: b.winratePct,
    fmt: (_n) => '', // replaced below with the Wilson-annotated form
    fmtDelta: (n) => `${n} pts`,
  })
  row.aDisplay = winrateDisplay(a)
  row.bDisplay = winrateDisplay(b)
  row.lowSample = lowSample
  return row
}

function decisiveOf(m: SeasonMetrics): number {
  return m.wins + m.losses
}

function winrateDisplay(m: SeasonMetrics): string {
  const decisive = decisiveOf(m)
  if (m.winratePct == null || decisive === 0) return '—'
  const margin = wilsonMargin(m.wins, decisive)
  const marginPart = margin == null ? '' : ` ±${margin}`
  return `${m.winratePct}%${marginPart} · n=${decisive}`
}

function per10(n: number): string {
  return n.toFixed(1)
}

// Snap to one decimal — the combat rows' display precision — so the verdict is
// judged on the same value the user sees.
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// timeRow shows each column's pre-formatted play-time; the delta is neutral (more
// time played is context, not "better"), rendered as a signed minute count.
function timeRow(a: SeasonMetrics, b: SeasonMetrics): ComparisonRow {
  const row = numericRow({
    key: 'time',
    label: 'Time played',
    dir: 'neutral',
    a: a.minutesPlayed,
    b: b.minutesPlayed,
    fmt: () => '',
    fmtDelta: (n) => `${n} min`,
    quantize: Math.round,
  })
  row.aDisplay = a.timeLabel
  row.bDisplay = b.timeLabel
  return row
}

// modeRows unions the game modes present in either season (canonical order
// preserved from the aggregate) and renders a win-rate + games row for each.
function modeRows(a: SeasonMetrics, b: SeasonMetrics): ComparisonRow[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const m of [...a.modes, ...b.modes]) {
    if (!seen.has(m.key)) { seen.add(m.key); keys.push(m.key) }
  }
  const empty: RateStat = { winrate: 0, games: 0 }
  return keys.map((k) => {
    const am = a.modes.find((m) => m.key === k)
    const bm = b.modes.find((m) => m.key === k)
    const label = (am ?? bm)!.label
    return rateRow(`mode:${k}`, label, am ?? empty, bm ?? empty)
  })
}

// ─── Public API ───────────────────────────────────────────────────────────

// compareSeasons turns two season snapshots into the labelled sections of the
// comparison table. Season B is compared against season A.
export function compareSeasons(a: SeasonMetrics, b: SeasonMetrics): ComparisonSection[] {
  return [
    {
      title: 'Overview',
      rows: [
        displayRow('record', 'Record (W–L–D)', `${a.wins}–${a.losses}–${a.draws}`, `${b.wins}–${b.losses}–${b.draws}`),
        intRow('games', 'Games', 'neutral', a.games, b.games),
        intRow('compGames', 'Competitive games', 'neutral', a.competitiveGames, b.competitiveGames),
        intRow('qpGames', 'Quick play games', 'neutral', a.quickPlayGames, b.quickPlayGames),
        intRow('roleQueue', 'Role queue games', 'neutral', a.roleQueueGames, b.roleQueueGames),
        intRow('openQueue', 'Open queue games', 'neutral', a.openQueueGames, b.openQueueGames),
        winrateRow(a, b),
      ],
    },
    {
      title: 'Combat',
      rows: [
        numericRow({ key: 'elims', label: 'Eliminations / 10 min', dir: 'higher-better', a: a.elimsPer10, b: b.elimsPer10, fmt: per10, fmtDelta: per10, quantize: round1 }),
        numericRow({ key: 'deaths', label: 'Deaths / 10 min', dir: 'lower-better', a: a.deathsPer10, b: b.deathsPer10, fmt: per10, fmtDelta: per10, quantize: round1 }),
        numericRow({ key: 'assists', label: 'Assists / 10 min', dir: 'higher-better', a: a.assistsPer10, b: b.assistsPer10, fmt: per10, fmtDelta: per10, quantize: round1 }),
      ],
    },
    {
      title: 'Consistency',
      rows: [
        timeRow(a, b),
        intRow('longestWin', 'Longest win streak', 'higher-better', a.longestWinStreak, b.longestWinStreak),
        intRow('longestLose', 'Longest losing streak', 'lower-better', a.longestLosingStreak, b.longestLosingStreak),
      ],
    },
    {
      title: 'Roles',
      rows: [
        rateRow('roleTank', 'Tank win rate', a.roleTank, b.roleTank),
        rateRow('roleDps', 'DPS win rate', a.roleDps, b.roleDps),
        rateRow('roleSupport', 'Support win rate', a.roleSupport, b.roleSupport),
        intRow('poolTank', 'Hero pool (Tank)', 'neutral', a.heroPoolTank, b.heroPoolTank),
        intRow('poolDps', 'Hero pool (DPS)', 'neutral', a.heroPoolDps, b.heroPoolDps),
        intRow('poolSupport', 'Hero pool (Support)', 'neutral', a.heroPoolSupport, b.heroPoolSupport),
        heroStatRow('bestTank', 'Best Tank hero', a.bestHeroTank, b.bestHeroTank),
        heroStatRow('bestDps', 'Best DPS hero', a.bestHeroDps, b.bestHeroDps),
        heroStatRow('bestSupport', 'Best Support hero', a.bestHeroSupport, b.bestHeroSupport),
      ],
    },
    {
      title: 'Maps',
      rows: [
        displayRow('topMap', 'Most-played map', a.topMap, b.topMap),
        ...modeRows(a, b),
      ],
    },
    {
      title: 'Heroes',
      rows: [
        displayRow('topHero', 'Most-played hero', a.topHero, b.topHero),
        heroStatRow('worstHero', 'Lowest win-rate hero (≥5 games)', a.worstHero, b.worstHero),
      ],
    },
  ]
}
