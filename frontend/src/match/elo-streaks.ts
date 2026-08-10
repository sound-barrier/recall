// Streaks × rank for the Elo Calculator. Two measurable claims behind
// "streaks decide my rank": the BEHAVIORAL one (does the next-game win
// rate sag as a loss streak deepens?) and the MECHANICAL one (the rank
// card's own 'win streak' / 'loss streak' modifiers move the meter more
// per game, so every extra game inside a streak has more ground to give).

import type { MatchRecord } from '@/api-client'
import { matchEpoch } from '@/match/match-trends-helpers'

type StreakInput = Pick<MatchRecord, 'match_key' | 'data'>

// decisiveTimeline is the chronological decisive sequence WITH timestamps —
// draws and rows without a placeable time drop out. The shared spine for
// the runs test, the streak-depth walk, and the change-point scan.
export function decisiveTimeline(records: readonly StreakInput[]): { t: number; win: boolean }[] {
  const timed: { t: number; win: boolean }[] = []
  for (const rec of records) {
    const result = rec.data?.result
    if (result !== 'victory' && result !== 'defeat') continue
    const t = matchEpoch(rec)
    if (t === null) continue
    timed.push({ t, win: result === 'victory' })
  }
  timed.sort((a, b) => a.t - b.t)
  return timed
}

export interface TiltEpisodes {
  episodes: number // sittings that reached minRun straight losses
  tiltGames: number // decisive games queued past the (minRun-1)th straight loss
  tiltWins: number
}

// tiltEpisodes counts the times the player queued through minRun+
// consecutive losses in ONE sitting (games closer than gapHours), plus
// every further game played from the (minRun-1)th straight loss on — the
// tilt-queue games whose meter usually has to be won back later.
export function tiltEpisodes(
  records: readonly StreakInput[],
  opts: { minRun?: number; gapHours?: number } = {},
): TiltEpisodes {
  const minRun = opts.minRun ?? 5
  const gapMs = (opts.gapHours ?? 3) * 3_600_000
  const seq = decisiveTimeline(records)
  const out: TiltEpisodes = { episodes: 0, tiltGames: 0, tiltWins: 0 }
  let lossRun = 0
  let counted = false
  for (let i = 0; i < seq.length; i++) {
    if (i > 0 && seq[i]!.t - seq[i - 1]!.t >= gapMs) {
      lossRun = 0
      counted = false
    }
    // Queuing with minRun-1 straight losses already on the board IS the
    // tilt queue — this game and everything after it in the sitting.
    if (lossRun >= minRun - 1) {
      out.tiltGames++
      if (seq[i]!.win) out.tiltWins++
    }
    if (seq[i]!.win) {
      lossRun = 0
      counted = false
    } else {
      lossRun++
      if (lossRun >= minRun && !counted) {
        out.episodes++
        counted = true
      }
    }
  }
  return out
}

// decisiveResults is the same sequence as bare win/loss flags.
export function decisiveResults(records: readonly StreakInput[]): boolean[] {
  return decisiveTimeline(records).map((x) => x.win)
}

export interface AfterResultCounts {
  winAfterWin: number
  lossAfterWin: number
  winAfterLoss: number
  lossAfterLoss: number
}

// afterResultCounts is the exact 2×2 table of next-game outcomes by the
// previous game's outcome — the input the tilt significance test needs
// (rates alone lose the counts to rounding).
export function afterResultCounts(records: readonly StreakInput[]): AfterResultCounts {
  const seq = decisiveResults(records)
  const out: AfterResultCounts = { winAfterWin: 0, lossAfterWin: 0, winAfterLoss: 0, lossAfterLoss: 0 }
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1]) {
      if (seq[i]) out.winAfterWin++
      else out.lossAfterWin++
    } else if (seq[i]) out.winAfterLoss++
    else out.lossAfterLoss++
  }
  return out
}

interface StreakDepthRate {
  depth: number // 1, 2, …, maxDepth — the last bucket means "maxDepth or more"
  winrate: number | null // integer %, null with no sample
  sample: number
}

export interface StreakDepthBreakdown {
  baselineWinrate: number | null
  baselineSample: number
  afterLoss: StreakDepthRate[]
  afterWin: StreakDepthRate[]
}

// winrateByStreakDepth extends the one-game tilt stat to the whole run:
// the next-game win rate bucketed by how deep the current streak already
// is. The actionable readout is the afterLoss gradient — where it sags is
// where stepping away starts paying.
export function winrateByStreakDepth(records: readonly StreakInput[], maxDepth = 3): StreakDepthBreakdown {
  const seq = decisiveResults(records)
  const mk = () => Array.from({ length: maxDepth }, (_, i) => ({ depth: i + 1, wins: 0, n: 0 }))
  const loss = mk()
  const win = mk()
  let baselineWins = 0
  for (let i = 0; i < seq.length; i++) {
    if (seq[i]) baselineWins++
    if (i === 0) continue
    let run = 1
    while (i - 1 - run >= 0 && seq[i - 1 - run] === seq[i - 1]) run++
    const bucket = (seq[i - 1] ? win : loss)[Math.min(run, maxDepth) - 1]!
    bucket.n++
    if (seq[i]) bucket.wins++
  }
  const rate = (b: { depth: number; wins: number; n: number }): StreakDepthRate => ({
    depth: b.depth,
    winrate: b.n === 0 ? null : Math.round((b.wins / b.n) * 100),
    sample: b.n,
  })
  return {
    baselineWinrate: seq.length === 0 ? null : Math.round((baselineWins / seq.length) * 100),
    baselineSample: seq.length,
    afterLoss: loss.map(rate),
    afterWin: win.map(rate),
  }
}

export interface StreakMeterImpact {
  streakAbsMean: number // mean |change_percent| on streak-modified rank cards
  normalAbsMean: number // …and on the rest
  ratio: number // streak ÷ normal — "streak games move the meter N× as much"
  streakN: number
  normalN: number
  winStreakNet: number // summed signed meter % across 'win streak' games
  lossStreakNet: number // …and across 'loss streak' games (negative)
}

// METER_IMPACT_FLOOR: fewer qualifying readings than this on either side
// and the split is noise, not a finding. Matches the season simulator's
// MIN_POOL — a ratio of two three-sample means once shipped as "2.4×
// inside streaks", which is exactly the low-n overclaim this page stopped
// making.
const METER_IMPACT_FLOOR = 8

// streakMeterImpact splits the player's own rank-card meter moves by the
// parser's streak modifiers. Calibration readings and exact zeroes are
// excluded (same rule as the calculator's meter seeding).
export function streakMeterImpact(records: readonly Pick<MatchRecord, 'data'>[]): StreakMeterImpact | null {
  const streak: number[] = []
  const normal: number[] = []
  let winStreakNet = 0
  let lossStreakNet = 0
  for (const rec of records) {
    const cp = rec.data?.change_percent
    if (typeof cp !== 'number' || cp === 0) continue
    const mods = rec.data?.modifiers ?? []
    if (mods.includes('calibration')) continue
    // 'winning trend' / 'losing trend' are the 2026-07 UI's wording for the
    // same streak chips — bucket both generations together.
    if (mods.includes('win streak') || mods.includes('winning trend')) {
      streak.push(Math.abs(cp))
      winStreakNet += cp
    } else if (mods.includes('loss streak') || mods.includes('losing trend')) {
      streak.push(Math.abs(cp))
      lossStreakNet += cp
    } else {
      normal.push(Math.abs(cp))
    }
  }
  if (streak.length < METER_IMPACT_FLOOR || normal.length < METER_IMPACT_FLOOR) return null
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
  const streakAbsMean = mean(streak)
  const normalAbsMean = mean(normal)
  return {
    streakAbsMean,
    normalAbsMean,
    ratio: streakAbsMean / normalAbsMean,
    streakN: streak.length,
    normalN: normal.length,
    winStreakNet,
    lossStreakNet,
  }
}
