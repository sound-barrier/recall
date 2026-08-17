// Plain-language number formatting for the Elo Calculator. Everything here
// trades statistical wording for a phrasing a ranked player reads at a glance;
// the raw stat stays available in a muted aside only where it earns its place.
import type { GamesRange } from '@/match/elo/elo-model'
import { TIER_ORDER } from '@/match/trends/match-trends-helpers'
import { LADDER_MAX } from '@/match/elo/elo-model'

// Decay estimates near the plateau blow up; past this they mean "never" in
// practice, so we say so instead of printing a meaningless big number.
const GAMES_DISPLAY_CAP = 9999

export function fmtRank(tier: string, division: number): string {
  return `${tier.charAt(0).toUpperCase() + tier.slice(1)} ${division}`
}

// fmtScoreRank names the tier + division a ladder score lands in ("Master 5"),
// dropping the within-division percentage for prose.
export function fmtScoreRank(score: number): string {
  // Just inside the top so the last tier decodes to itself rather than
  // rolling over into a nonexistent one above it.
  const clamped = Math.min(LADDER_MAX - 0.001, Math.max(0, score))
  const tier = TIER_ORDER[Math.floor(clamped / 5)] ?? 'champion'
  const division = 5 - Math.floor(clamped % 5)
  return fmtRank(tier, division)
}

export function fmtGames(games: number | null): string {
  if (games === null) return '—'
  if (games === 0) return 'Already there'
  if (games > GAMES_DISPLAY_CAP) return 'Effectively never'
  const n = Math.ceil(games)
  return `~${n} game${n === 1 ? '' : 's'}`
}

// fmtGamesRange turns the 95% interval into a best-case / unlucky-run spread —
// no "confidence interval" wording. An open upper bound is the honest "at this
// few games a real cold streak can't be ruled out".
export function fmtGamesRange(range: GamesRange, sampleN: number): string {
  if (range.lower === null) return ''
  const best = Math.ceil(range.lower)
  if (range.upper === null) {
    return `Best case ~${best}; with a sample of ${sampleN} game${sampleN === 1 ? '' : 's'}, a cold streak can't be ruled out`
  }
  if (range.upper > GAMES_DISPLAY_CAP) {
    return `Best case ~${best}; an unlucky run, far longer`
  }
  return `Best case ~${best}; an unlucky run ~${Math.ceil(range.upper)}`
}

export function fmtWeeks(weeks: number | null): string {
  if (weeks === null) return ''
  if (weeks > 520) return 'years at your current pace'
  const rounded = weeks < 10 ? Math.round(weeks * 10) / 10 : Math.round(weeks)
  return `≈ ${rounded} week${rounded === 1 ? '' : 's'} at your pace`
}

// fmtProb keeps the extremes honest — a flat 100%/0% overpromises, so the
// wording softens even when the number rounds all the way.
export function fmtProb(p: number | null): string {
  if (p === null) return '—'
  if (p >= 0.995) return 'almost certain'
  if (p <= 0.005) return 'very unlikely'
  return `${Math.round(p * 100)}% chance`
}

export function fmtPct(value: number | null, digits = 0): string {
  if (value === null) return '—'
  return `${value.toFixed(digits)}%`
}

export function fmtPValue(p: number | null): string {
  if (p === null) return '—'
  // Three decimals floor at 0.001 — anything smaller printed the absurd
  // "p = 0.000", which reads as exactly zero.
  if (p < 0.001) return 'p < 0.001'
  return `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`
}
