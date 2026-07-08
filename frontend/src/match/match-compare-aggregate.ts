import type { MatchRecord } from '@/api-client'

// Compare-specific per-season breakdowns the dossier doesn't expose directly —
// per-role hero pools + best hero, worst hero, per-game-mode win rate, and the
// playlist / queue-type game counts. All pure over a record slice + the OW-data
// resolvers so they're unit-testable; the view stitches them into a SeasonMetrics
// snapshot alongside the dossier's scalars.

export type Role = 'tank' | 'dps' | 'support'

// A hero's line: display name + win rate (integer %, draws excluded) + total
// games it was played in. `null` when no hero qualifies.
export interface HeroStat {
  hero: string
  winrate: number
  games: number
}

// One game-mode's line for the Maps section.
export interface ModeStat {
  key: string
  label: string
  winrate: number
  games: number
}

type HeroRoleResolver = (hero: string | null | undefined) => string
type NameResolver = (input: string | null | undefined) => string

interface WinLoss { w: number; l: number; games: number }

function winratePct(wl: WinLoss): number {
  const decisive = wl.w + wl.l
  return decisive === 0 ? 0 : Math.round((wl.w / decisive) * 100)
}

function tally(map: Map<string, WinLoss>, key: string, result: string | null | undefined): void {
  const wl = map.get(key) ?? { w: 0, l: 0, games: 0 }
  wl.games++
  if (result === 'victory') wl.w++
  else if (result === 'defeat') wl.l++
  map.set(key, wl)
}

// Per-hero W/L over the slice: a match credits every distinct hero in its
// heroes_played, so a hero's win rate is the record of matches it appeared in.
function heroTally(records: MatchRecord[]): Map<string, WinLoss> {
  const map = new Map<string, WinLoss>()
  for (const r of records) {
    const seen = new Set<string>()
    for (const hp of r.data?.heroes_played ?? []) {
      if (!hp.hero || seen.has(hp.hero)) continue
      seen.add(hp.hero)
      tally(map, hp.hero, r.data?.result)
    }
  }
  return map
}

// heroPoolsByRole counts distinct heroes played in each role.
export function heroPoolsByRole(records: MatchRecord[], heroRole: HeroRoleResolver): Record<Role, number> {
  const sets: Record<Role, Set<string>> = { tank: new Set(), dps: new Set(), support: new Set() }
  for (const r of records) {
    for (const hp of r.data?.heroes_played ?? []) {
      if (!hp.hero) continue
      const role = heroRole(hp.hero)
      if (role === 'tank' || role === 'dps' || role === 'support') sets[role].add(hp.hero)
    }
  }
  return { tank: sets.tank.size, dps: sets.dps.size, support: sets.support.size }
}

function better(a: HeroStat, b: HeroStat): HeroStat {
  if (b.winrate > a.winrate) return b
  if (b.winrate === a.winrate && b.games > a.games) return b
  return a
}

function worse(a: HeroStat, b: HeroStat): HeroStat {
  if (b.winrate < a.winrate) return b
  if (b.winrate === a.winrate && b.games > a.games) return b
  return a
}

// bestHeroByRole picks the highest-win-rate hero in each role among heroes with
// at least `minGames` DECISIVE games (so a 1-game 100% hero can't win); ties
// break toward more games. `heroDisplay` resolves the stored key to a name.
export function bestHeroByRole(
  records: MatchRecord[],
  heroRole: HeroRoleResolver,
  heroDisplay: NameResolver,
  minGames: number,
): Record<Role, HeroStat | null> {
  const out: Record<Role, HeroStat | null> = { tank: null, dps: null, support: null }
  for (const [hero, wl] of heroTally(records)) {
    if (wl.w + wl.l < minGames) continue
    const role = heroRole(hero)
    if (role !== 'tank' && role !== 'dps' && role !== 'support') continue
    const stat: HeroStat = { hero: heroDisplay(hero), winrate: winratePct(wl), games: wl.games }
    out[role] = out[role] ? better(out[role]!, stat) : stat
  }
  return out
}

// worstHero picks the lowest-win-rate hero over the slice among heroes with at
// least `minGames` decisive games; ties break toward more games (more damning).
export function worstHero(records: MatchRecord[], heroDisplay: NameResolver, minGames: number): HeroStat | null {
  let out: HeroStat | null = null
  for (const [hero, wl] of heroTally(records)) {
    if (wl.w + wl.l < minGames) continue
    const stat: HeroStat = { hero: heroDisplay(hero), winrate: winratePct(wl), games: wl.games }
    out = out ? worse(out, stat) : stat
  }
  return out
}

const MODE_LABELS: readonly (readonly [string, string])[] = [
  ['control', 'Control'], ['escort', 'Escort'], ['hybrid', 'Hybrid'],
  ['push', 'Push'], ['flashpoint', 'Flashpoint'], ['clash', 'Clash'],
]

// modeBreakdown is per-game-mode games + win rate, in canonical mode order,
// dropping modes with no games in the slice.
export function modeBreakdown(records: MatchRecord[], mapGameMode: NameResolver): ModeStat[] {
  const map = new Map<string, WinLoss>()
  for (const r of records) {
    const mode = mapGameMode(r.data?.map)
    if (!mode) continue
    tally(map, mode, r.data?.result)
  }
  const out: ModeStat[] = []
  for (const [key, label] of MODE_LABELS) {
    const wl = map.get(key)
    if (wl) out.push({ key, label, winrate: winratePct(wl), games: wl.games })
  }
  return out
}

// topMap is the most-played map's display name (null when the slice is mapless).
export function topMap(records: MatchRecord[], mapDisplay: NameResolver): string | null {
  const counts = new Map<string, number>()
  for (const r of records) {
    const map = r.data?.map
    if (map) counts.set(map, (counts.get(map) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [map, n] of counts) {
    if (n > bestN) { best = map; bestN = n }
  }
  return best ? mapDisplay(best) : null
}

// playlistCounts splits the slice into competitive vs quick-play game counts.
export function playlistCounts(records: MatchRecord[]): { competitive: number; quickplay: number } {
  let competitive = 0
  let quickplay = 0
  for (const r of records) {
    if (r.data?.playlist === 'competitive') competitive++
    else if (r.data?.playlist === 'quickplay') quickplay++
  }
  return { competitive, quickplay }
}

// queueCounts splits by the effective queue-type override (role vs open queue).
export function queueCounts(records: MatchRecord[]): { role: number; open: number } {
  let role = 0
  let open = 0
  for (const r of records) {
    if (r.queue_type === 'role') role++
    else if (r.queue_type === 'open') open++
  }
  return { role, open }
}
