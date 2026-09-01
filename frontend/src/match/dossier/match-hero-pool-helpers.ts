import type { MatchRecord } from '@/api-client'
import { LOW_SAMPLE_N, wilsonLowerBound } from '@/match/dossier/match-sample-helpers'

// Hero-swap discipline: how many heroes a match was MEANINGFULLY played on,
// the user's derived hero pool, and what reaching outside that pool costs.
// A hero under the percent-played threshold (default 5%) was probably touched
// to contest the point — it is not a swap and never counts. Pure over a record
// slice so the dossier widgets and the Compare tab share one set of semantics.

export const DEFAULT_HERO_MEANINGFUL_PCT = 5

// One bucket of the "heroes per match" breakdown. `total` counts every match
// in the bucket; `winrate` follows the house convention (decisive-only).
export interface HeroCountBucket {
  key: string // '1 hero' | '2 heroes' | '3 heroes' | '4+ heroes'
  heroes: number // 1..4 (4 = "4 or more")
  total: number
  wins: number
  decisive: number // wins + losses (draws excluded)
  winrate: number
  lowSample: boolean
}

// A pool member (or an out-of-pool hero) with its record over the slice.
export interface PoolHeroStat {
  key: string // raw hero key, display-resolved by the view
  role: string // 'tank' | 'dps' | 'support' | '' when unresolvable
  total: number // matches meaningfully played (all results)
  wins: number
  losses: number // decisive losses (draws excluded)
  winrate: number // decisive-only integer percent
  lowSample: boolean
}

// The pool reads in team-composition order: Tank, then DPS, then Support
// (unresolvable roles last), heroes alphabetical within each role.
const ROLE_ORDER: Record<string, number> = { tank: 0, dps: 1, support: 2 }

function roleRank(role: string): number {
  return ROLE_ORDER[role] ?? 3
}

type HeroRoleResolver = (hero: string | null | undefined) => string

// One side of the in-pool / out-of-pool split.
interface PoolSplitSide {
  games: number
  wins: number
  decisive: number // wins + losses (draws excluded) — the winrate's real n
  winrate: number // decisive-only; 0 when no decisive game
}

export interface PoolSplit {
  pure: PoolSplitSide
  out: PoolSplitSide
}

// The full pool analysis a consumer renders: the derived pool, the in/out
// split against it, and each out-of-pool hero's record.
export interface HeroPoolAnalysis {
  pool: PoolHeroStat[]
  split: PoolSplit
  outHeroes: PoolHeroStat[]
}

// analyzeHeroPool bundles the derive → split → out-heroes walk against one
// slice — the single entry point the dossier query and the Compare snapshot
// both call, so the two surfaces can never disagree.
export function analyzeHeroPool(
  records: readonly Pick<MatchRecord, 'data'>[],
  thresholdPct = DEFAULT_HERO_MEANINGFUL_PCT,
  heroRole: HeroRoleResolver = () => '',
): HeroPoolAnalysis {
  const pool = deriveHeroPool(records, thresholdPct, heroRole)
  const names = pool.map((p) => p.key)
  return {
    pool,
    split: poolSplit(records, names, thresholdPct),
    outHeroes: outOfPoolHeroes(records, names, thresholdPct, heroRole),
  }
}

// meaningfulHeroes returns the deduped heroes a match was meaningfully played
// on: heroes_played entries at/above the threshold. A MISSING percent_played is
// unknown, not zero — the parser omits it for heroes known only from the
// PERSONAL roster (which lists every hero played but shows no per-hero %), and
// its contract explicitly warns against filtering them as not-played. A record
// whose PRESENT percentages all fall below the threshold falls back to the
// primary data.hero — a match was necessarily played on SOMETHING — and a
// record with no hero data at all yields [] (excluded from every tally here).
// A percent below the threshold was probably a point-contest touch; an
// ABSENT percent is unknown, not zero, and always qualifies.
function clearsThreshold(hp: { percent_played?: number }, thresholdPct: number): boolean {
  return hp.percent_played === undefined || hp.percent_played >= thresholdPct
}

// A match was necessarily played on SOMETHING — the primary data.hero
// backstops a record whose present percentages all fall below the
// threshold (or that has no heroes_played at all).
function primaryHeroFallback(rec: Pick<MatchRecord, 'data'>): string[] {
  return rec.data?.hero ? [rec.data.hero] : []
}

export function meaningfulHeroes(
  rec: Pick<MatchRecord, 'data'>,
  thresholdPct = DEFAULT_HERO_MEANINGFUL_PCT,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const hp of rec.data?.heroes_played ?? []) {
    if (!hp.hero || seen.has(hp.hero)) continue
    if (!clearsThreshold(hp, thresholdPct)) continue
    seen.add(hp.hero)
    out.push(hp.hero)
  }
  if (out.length > 0) return out
  return primaryHeroFallback(rec)
}

function isWin(r: Pick<MatchRecord, 'data'>): boolean {
  return r.data?.result === 'victory'
}

function isDecisive(r: Pick<MatchRecord, 'data'>): boolean {
  return r.data?.result === 'victory' || r.data?.result === 'defeat'
}

// Bucket display key: the 4-bucket is open-ended ("4+ heroes").
function poolSizeLabel(n: number): string {
  if (n === 1) return '1 hero'
  if (n === 4) return '4+ heroes'
  return `${n} heroes`
}

function decisiveWinrate(wins: number, decisive: number): number {
  return decisive === 0 ? 0 : Math.round((wins / decisive) * 100)
}

// heroCountBuckets groups matches by meaningful-hero count (1 / 2 / 3 / 4+).
// Empty buckets are omitted; matches with no known hero don't appear.
export function heroCountBuckets(
  records: readonly Pick<MatchRecord, 'data'>[],
  thresholdPct = DEFAULT_HERO_MEANINGFUL_PCT,
): HeroCountBucket[] {
  const tallies = new Map<number, { total: number; wins: number; decisive: number }>()
  for (const r of records) {
    const count = meaningfulHeroes(r, thresholdPct).length
    if (count === 0) continue
    const bucket = Math.min(count, 4)
    const t = tallies.get(bucket) ?? { total: 0, wins: 0, decisive: 0 }
    t.total++
    if (isDecisive(r)) {
      t.decisive++
      if (isWin(r)) t.wins++
    }
    tallies.set(bucket, t)
  }
  return [1, 2, 3, 4]
    .filter((n) => tallies.has(n))
    .map((n) => {
      const t = tallies.get(n)!
      return {
        key: poolSizeLabel(n),
        heroes: n,
        total: t.total,
        wins: t.wins,
        decisive: t.decisive,
        winrate: decisiveWinrate(t.wins, t.decisive),
        lowSample: t.decisive < LOW_SAMPLE_N,
      }
    })
}

// Per-hero record over the slice: a match credits each hero it was
// meaningfully played on.
function heroTally(
  records: readonly Pick<MatchRecord, 'data'>[],
  thresholdPct: number,
): Map<string, { total: number; wins: number; decisive: number }> {
  const map = new Map<string, { total: number; wins: number; decisive: number }>()
  for (const r of records) {
    for (const hero of meaningfulHeroes(r, thresholdPct)) {
      const t = map.get(hero) ?? { total: 0, wins: 0, decisive: 0 }
      t.total++
      if (isDecisive(r)) {
        t.decisive++
        if (isWin(r)) t.wins++
      }
      map.set(hero, t)
    }
  }
  return map
}

function toStat(key: string, role: string, t: { total: number; wins: number; decisive: number }): PoolHeroStat {
  return {
    key,
    role,
    total: t.total,
    wins: t.wins,
    losses: t.decisive - t.wins,
    winrate: decisiveWinrate(t.wins, t.decisive),
    lowSample: t.decisive < LOW_SAMPLE_N,
  }
}

// A hero joins the pool at 10% of the slice's decisive games (floored at
// LOW_SAMPLE_N). The floor rules small histories — the caveat threshold and
// the pool floor coincide there — while the share keeps a large corpus's pool
// to actual mains: at 500 decisive games, crossing 5 games on a dozen heroes
// must not empty "out of pool" of meaning. The share is relative because pool
// membership is about identity; the n<5 CAVEAT stays absolute because a
// rate's noise depends only on its sample count, never on its share.
const POOL_SHARE_PCT = 10

// deriveHeroPool: the heroes with enough meaningful DECISIVE games in the
// slice — max(LOW_SAMPLE_N, 10% of the slice's decisive games) — to count as
// the player's identity, not an experiment. Sorted Tank → DPS → Support, then
// hero name, so the pool reads like a team composition.
export function deriveHeroPool(
  records: readonly Pick<MatchRecord, 'data'>[],
  thresholdPct = DEFAULT_HERO_MEANINGFUL_PCT,
  heroRole: HeroRoleResolver = () => '',
): PoolHeroStat[] {
  const decisiveGames = records.filter((r) => isDecisive(r) && meaningfulHeroes(r, thresholdPct).length > 0).length
  const floor = Math.max(LOW_SAMPLE_N, Math.ceil((POOL_SHARE_PCT / 100) * decisiveGames))
  return [...heroTally(records, thresholdPct).entries()]
    .filter(([, t]) => t.decisive >= floor)
    .map(([key, t]) => toStat(key, heroRole(key), t))
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.key.localeCompare(b.key))
}

// poolSplit classifies each match: PURE when every meaningful hero is in the
// pool, OUT when any meaningful hero is outside it. Matches with no known
// hero belong to neither side.
export function poolSplit(
  records: readonly Pick<MatchRecord, 'data'>[],
  pool: readonly string[],
  thresholdPct = DEFAULT_HERO_MEANINGFUL_PCT,
): PoolSplit {
  const inPool = new Set(pool)
  const sides = {
    pure: { games: 0, wins: 0, decisive: 0 },
    out: { games: 0, wins: 0, decisive: 0 },
  }
  for (const r of records) {
    const heroes = meaningfulHeroes(r, thresholdPct)
    if (heroes.length === 0) continue
    const side = heroes.every((h) => inPool.has(h)) ? sides.pure : sides.out
    side.games++
    if (isDecisive(r)) {
      side.decisive++
      if (isWin(r)) side.wins++
    }
  }
  const finish = (s: { games: number; wins: number; decisive: number }): PoolSplitSide => ({
    games: s.games,
    wins: s.wins,
    decisive: s.decisive,
    winrate: decisiveWinrate(s.wins, s.decisive),
  })
  return { pure: finish(sides.pure), out: finish(sides.out) }
}

// outOfPoolHeroes: each hero OUTSIDE the pool with its record when
// meaningfully played, sorted worst-first (Wilson floor ascending, so a
// consistently-losing swap ranks above a single bad game).
export function outOfPoolHeroes(
  records: readonly Pick<MatchRecord, 'data'>[],
  pool: readonly string[],
  thresholdPct = DEFAULT_HERO_MEANINGFUL_PCT,
  heroRole: HeroRoleResolver = () => '',
): PoolHeroStat[] {
  const inPool = new Set(pool)
  return [...heroTally(records, thresholdPct).entries()]
    .filter(([key]) => !inPool.has(key))
    .map(([key, t]) => ({ stat: toStat(key, heroRole(key), t), rank: wilsonLowerBound(t.wins, t.decisive) }))
    .sort((a, b) => a.rank - b.rank || b.stat.total - a.stat.total)
    .map((x) => x.stat)
}

// The three pool contexts the Hero Pool band's toggle switches between. Role
// and Open are the two ranked queue types (rank is tracked per queue); Quickplay
// is the casual play mode. Kept separate because a hero pool — and the rank it
// feeds — means something different in each.
export type PoolMode = 'role' | 'open' | 'quickplay'

// matchesPoolMode partitions the corpus into the three pool contexts. Quickplay
// is the casual play mode regardless of queue; Role and Open are competitive.
// Role is the DEFAULT ranked bucket — an explicit 'open' queue_type goes to Open
// Queue, and anything else competitive (role, or an unlabeled comp match that
// predates queue detection) counts as Role Queue, so the band never strands
// real games in no mode.
export function matchesPoolMode(
  rec: Pick<MatchRecord, 'data' | 'queue_type' | 'play_mode'>,
  mode: PoolMode,
): boolean {
  const playMode = rec.play_mode ?? rec.data?.playlist
  if (mode === 'quickplay') return playMode === 'quickplay'
  if (playMode !== 'competitive') return false
  return mode === 'open' ? rec.queue_type === 'open' : rec.queue_type !== 'open'
}

// A single match's standing against a pool. 'none' = no known hero (counted by
// neither side), mirroring poolSplit.
export type PoolSide = 'pure' | 'off' | 'none'

// classifyPoolMembership is the per-record form of poolSplit — 'pure' when every
// meaningful hero is in the pool, 'off' when any is outside. The Hero Pool
// band's in/out-of-pool narrow filter runs this per match.
export function classifyPoolMembership(
  rec: Pick<MatchRecord, 'data'>,
  pool: ReadonlySet<string>,
  thresholdPct = DEFAULT_HERO_MEANINGFUL_PCT,
): PoolSide {
  const heroes = meaningfulHeroes(rec, thresholdPct)
  if (heroes.length === 0) return 'none'
  return heroes.every((h) => pool.has(h)) ? 'pure' : 'off'
}

// A pool hero carrying its membership, for the merged display ranking.
export interface RankedPoolHero extends PoolHeroStat {
  inPool: boolean
}

// rankPoolHeroes merges the pool + out-of-pool heroes into ONE display ranking:
// statistically-meaningful heroes (n ≥ LOW_SAMPLE_N) first — a solid record
// outranks a noisy perfect one (55% over 35 games beats 100% over 3) — then win
// rate descending, then volume. Pool membership rides along so the view can
// badge each hero WITHOUT recolouring by pool status: a high-win off-pool hero
// should read as "play this more", a losing in-pool hero as "reconsider".
export function rankPoolHeroes(analysis: HeroPoolAnalysis): RankedPoolHero[] {
  return [
    ...analysis.pool.map((h) => ({ ...h, inPool: true })),
    ...analysis.outHeroes.map((h) => ({ ...h, inPool: false })),
  ].sort((a, b) =>
    Number(a.lowSample) - Number(b.lowSample)
    || b.winrate - a.winrate
    || (b.wins + b.losses) - (a.wins + a.losses)
    || a.key.localeCompare(b.key))
}

export interface RoleWinrate {
  role: string // 'tank' | 'dps' | 'support'
  games: number
  wins: number
  decisive: number
  winrate: number // decisive-only integer percent
}

// roleWinrates: decisive win rate per locked role (data.role) over the slice —
// the role-queue headers' "how am I doing on Tank?" number. Only the three
// canonical roles, in team-composition order; unresolvable roles are skipped.
export function roleWinrates(records: readonly Pick<MatchRecord, 'data'>[]): RoleWinrate[] {
  const order = ['tank', 'dps', 'support']
  const tally = new Map<string, { games: number; wins: number; decisive: number }>()
  for (const r of records) {
    const role = r.data?.role
    if (!role || !order.includes(role)) continue
    const t = tally.get(role) ?? { games: 0, wins: 0, decisive: 0 }
    t.games++
    if (isDecisive(r)) {
      t.decisive++
      if (isWin(r)) t.wins++
    }
    tally.set(role, t)
  }
  return order
    .filter((role) => tally.has(role))
    .map((role) => {
      const t = tally.get(role)!
      return { role, games: t.games, wins: t.wins, decisive: t.decisive, winrate: decisiveWinrate(t.wins, t.decisive) }
    })
}

// ─── How concentrated the pool is ────────────────────────────────────────

/** Share of total minutes past which one hero counts as over-relied-on. */
const OVER_RELIANCE_SHARE = 0.5

export interface HeroConcentration {
  /**
   * Normalized Herfindahl index over PLAY TIME: 1 is everything on one hero,
   * 0 is a perfectly even spread. Null when nothing was played — an unknown
   * spread is not a flat one.
   */
  score: number | null
  /**
   * The inverse Herfindahl: how many heroes an even spread would need to look
   * like this one. "3.2" reads better than "0.31" to someone deciding whether
   * to widen their pool.
   */
  effectiveHeroes: number
  /** The hero past OVER_RELIANCE_SHARE of the time, or '' when none is. */
  overReliance: string
  /** How many heroes carried any time at all. */
  heroes: number
}

/**
 * How concentrated a hero pool is, weighted by TIME.
 *
 * Match count cannot answer this: ten cameo appearances on a hero are not a
 * pool, and the existing pool helpers count matches because that is what a
 * win rate needs. Minutes is the honest denominator for "what do you actually
 * play", which is why this takes them rather than PoolHeroStat.
 *
 * Normalized so a one-hero player scores 1 rather than scoring whatever the
 * raw index happens to be at n=1 — the scale has to mean the same thing to
 * someone with two heroes and someone with nine.
 */
export function heroConcentration(
  played: readonly { key: string; minutes: number }[],
): HeroConcentration {
  const rows = played.filter((h) => h.minutes > 0)
  const total = rows.reduce((sum, h) => sum + h.minutes, 0)
  if (rows.length === 0 || total === 0) {
    return { score: null, effectiveHeroes: 0, overReliance: '', heroes: 0 }
  }
  const hhi = rows.reduce((sum, h) => sum + (h.minutes / total) ** 2, 0)
  const n = rows.length
  // Normalize against the even-spread floor (1/n), so the scale runs 0..1 for
  // any pool size. A single hero has no spread to measure and is 1 by
  // definition rather than by the formula, which divides by zero there.
  const score = n === 1 ? 1 : (hhi - 1 / n) / (1 - 1 / n)
  const top = rows.reduce((a, b) => (b.minutes > a.minutes ? b : a))
  return {
    score: Math.round(score * 100) / 100,
    effectiveHeroes: Math.round((1 / hhi) * 10) / 10,
    overReliance: top.minutes / total > OVER_RELIANCE_SHARE ? top.key : '',
    heroes: n,
  }
}
