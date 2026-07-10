// The hero what-if: nudge any hero's win rate a point at a time and watch
// the blended track rate move by that hero's share of the games. The point
// is pedagogical — a small improvement on a main shifts the climb far more
// than a big one on a rarely-played pick, and a slump does the reverse.
// Pure math; the composable layer owns the reactive state.

import type { HeroPickStat } from '@/match/elo-seed'

// One arrow press moves a hero this many points; a hero can be pushed at
// most 5 points either way from its measured rate (keeps the what-if in
// "realistic improvement" territory rather than fantasy).
export const HERO_ADJUST_STEP = 1
export const HERO_ADJUST_MAX = 5

export interface HeroWhatIf {
  deltaPts: number // blended win-rate shift, percentage points
  perHero: Map<string, { from: number; to: number }> // nudged in-scope heroes
}

// clampHeroAdjust steps an accumulated nudge one press in either
// direction, saturating at ±HERO_ADJUST_MAX.
export function clampHeroAdjust(current: number, dir: 1 | -1): number {
  const next = current + dir * HERO_ADJUST_STEP
  return Math.max(-HERO_ADJUST_MAX, Math.min(HERO_ADJUST_MAX, next))
}

// heroWhatIf blends the per-hero nudges into one rate shift. Scope follows
// the picker: with heroes selected, only they carry the sample (full
// weight); with none, every track hero weighs in by its game share. The
// denominator takes the larger of the track sample and the summed hero
// games so multi-hero credit can never amplify a nudge past itself.
export function heroWhatIf(
  stats: readonly HeroPickStat[],
  selected: ReadonlySet<string>,
  sampleN: number,
  adjustPts: ReadonlyMap<string, number>,
): HeroWhatIf {
  const scope = selected.size > 0 ? stats.filter((s) => selected.has(s.key)) : stats
  const scopeGames = scope.reduce((sum, h) => sum + h.wins + h.losses, 0)
  const denom = selected.size > 0 ? scopeGames : Math.max(sampleN, scopeGames)

  const perHero = new Map<string, { from: number; to: number }>()
  let deltaPts = 0
  if (denom <= 0) return { deltaPts, perHero }

  for (const h of scope) {
    const adjust = adjustPts.get(h.key)
    if (!adjust) continue
    const to = Math.max(0, Math.min(100, h.winrate + adjust))
    perHero.set(h.key, { from: h.winrate, to })
    deltaPts += ((h.wins + h.losses) / denom) * (to - h.winrate)
  }
  return { deltaPts, perHero }
}
