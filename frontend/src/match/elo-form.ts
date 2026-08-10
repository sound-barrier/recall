import { ladderScore, type Tier } from '@/match/match-trends-helpers'
import type { ProjectionInput } from '@/match/elo-model'
import { simulateSeasons, type MeterSamples, type SeasonSim } from '@/match/elo-simulate'

// Pure form-snapshot math for the Elo Calculator. useEloCalculator owns
// the refs; everything here is a plain function over the snapshot shape
// so the projection assembly stays testable without Vue reactivity.

/**
 * The snapshot of what the seed wrote into the form — the "measured"
 * baseline every edited-state affordance compares against.
 */
export interface EloFormSnapshot {
  currentTier: Tier
  currentDivision: number
  currentProgress: number
  targetTier: Tier
  targetDivision: number
  winRatePct: number | null
  sampleN: number
  meterMovePct: number
  gamesPerWeekInput: number | null
  decaySlopePts: number
}

/**
 * The all-clean marker set — what editedFields reports before a seed
 * has ever been applied (nothing to compare against yet).
 */
export const NO_EDITED_FIELDS: Record<keyof EloFormSnapshot, boolean> = {
  currentTier: false,
  currentDivision: false,
  currentProgress: false,
  targetTier: false,
  targetDivision: false,
  winRatePct: false,
  sampleN: false,
  meterMovePct: false,
  gamesPerWeekInput: false,
  decaySlopePts: false,
}

/** Per-field is-edited markers: current form values vs the seed baseline. */
export function diffSeededForm(
  baseline: EloFormSnapshot,
  current: EloFormSnapshot,
): Record<keyof EloFormSnapshot, boolean> {
  return {
    currentTier: current.currentTier !== baseline.currentTier,
    currentDivision: current.currentDivision !== baseline.currentDivision,
    currentProgress: current.currentProgress !== baseline.currentProgress,
    targetTier: current.targetTier !== baseline.targetTier,
    targetDivision: current.targetDivision !== baseline.targetDivision,
    winRatePct: current.winRatePct !== baseline.winRatePct,
    sampleN: current.sampleN !== baseline.sampleN,
    meterMovePct: current.meterMovePct !== baseline.meterMovePct,
    gamesPerWeekInput: current.gamesPerWeekInput !== baseline.gamesPerWeekInput,
    decaySlopePts: current.decaySlopePts !== baseline.decaySlopePts,
  }
}

/**
 * The meter's break-even rate: where the player's REAL pools zero the
 * drift (|L̄|/(W̄+|L̄|)). The simulator equilibrates there automatically;
 * the closed forms must share it or the verdict plateaus in a different
 * place than the seasons it quotes. Symmetric 0.5 until both pools are
 * deep enough to trust (the sim's own MIN_POOL rule).
 */
export function plateauRateFromMeter(meter: MeterSamples): number {
  const { winMoves, lossMoves } = meter
  if (winMoves.length < 8 || lossMoves.length < 8) return 0.5
  const mean = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length
  const w = mean(winMoves)
  const l = Math.abs(mean(lossMoves))
  return w + l > 0 ? l / (w + l) : 0.5
}

/**
 * Assemble the shared ProjectionInput from a form snapshot.
 *
 * The sample counts come from the MEASURED (or manually edited) rate —
 * never the hero-nudged one. A nudge is a hypothesis about future games;
 * baking it into sampleWins forged evidence and moved the p-value, the
 * posterior, and every interval toward games never played. winRate stays
 * the dialed rate so projections follow the what-if.
 */
export function projectionInputFromForm(
  form: EloFormSnapshot,
  plateauRate: number,
  dialedWinRatePct: number | null = form.winRatePct,
): ProjectionInput | null {
  const measured = form.winRatePct
  if (dialedWinRatePct === null || measured === null) return null
  if (form.sampleN <= 0 || form.meterMovePct <= 0) return null
  const currentScore = ladderScore(form.currentTier, form.currentDivision, form.currentProgress)
  const targetScore = ladderScore(form.targetTier, form.targetDivision, 0)
  if (currentScore === null || targetScore === null) return null
  const wins = Math.round((form.sampleN * measured) / 100)
  return {
    currentScore,
    targetScore,
    winRate: dialedWinRatePct / 100,
    sampleWins: wins,
    sampleLosses: form.sampleN - wins,
    meterMovePct: form.meterMovePct,
    decaySlope: form.decaySlopePts / 100,
    plateauRate,
  }
}

/**
 * Run the bootstrap season simulator from an assembled projection.
 * Null when there is no climb to simulate (target at or below current).
 * `rateShiftPts` carries the hero what-if as a location shift on the
 * drawn form — the posterior keeps the real sample's width.
 */
export function seasonSimFromProjection(
  inp: ProjectionInput,
  horizonGames: number,
  meter: MeterSamples,
  rateShiftPts = 0,
): SeasonSim | null {
  if (inp.targetScore <= inp.currentScore) return null
  return simulateSeasons({
    currentScore: inp.currentScore,
    targetScore: inp.targetScore,
    sampleWins: inp.sampleWins,
    sampleLosses: inp.sampleLosses,
    horizonGames,
    meter,
    symmetricFallbackPct: inp.meterMovePct,
    decaySlope: inp.decaySlope,
    rateShiftPts,
  })
}

/** Round to one decimal — the form's display precision. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10
}
