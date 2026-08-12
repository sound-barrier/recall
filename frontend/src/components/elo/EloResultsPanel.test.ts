import { describe, it, expect } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import { render, screen } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import EloResultsPanel from '@/components/elo/EloResultsPanel.vue'
import {
  provideEloCalculator, useEloCalculator, type EloCalculator,
} from '@/composables/elo/useEloCalculator'

// The two futures + the honest timeline. Everything here runs the REAL
// calculator over a fixture corpus: the panel's only job is choosing
// which sentence the model's numbers earn, and a stubbed calculator
// could make any branch "reachable" whether or not the model can
// actually produce it. The numbers themselves are pinned by the model
// suites — the assertions below are about the wording each one picks.

let seq = 0
type Rank = { tier: string; level: number; progress: number; change?: number }

function rec(over: { result?: 'victory' | 'defeat' | 'draw'; hero?: string; rank?: Rank } = {}): MatchRecord {
  seq++
  const iso = new Date(Date.UTC(2026, 5, 30) - seq * 6 * 3_600_000).toISOString()
  const hero = over.hero ?? 'lucio'
  return {
    match_key: `m${seq}`,
    queue_type: 'role',
    data: {
      playlist: 'competitive',
      hero,
      role: 'support',
      result: over.result ?? 'victory',
      date: iso.slice(0, 10),
      finished_at: iso.slice(11, 16),
      played_at_utc: iso,
      heroes_played: [{ hero, percent_played: 100 }],
      ...(over.rank
        ? { rank: over.rank.tier, level: over.rank.level, rank_progress: over.rank.progress, change_percent: over.rank.change }
        : {}),
    },
  } as unknown as MatchRecord
}

// 8W/6L over 14 decisive games, currently Gold 2 at 40% — too few rank
// readings to measure a decay slope, so the dial keeps its 1.5
// pts/division default and the ceiling range has no slope CI to widen it.
function basicCorpus(): MatchRecord[] {
  seq = 0
  return [
    rec({ rank: { tier: 'gold', level: 2, progress: 40, change: 22 } }),
    rec({ result: 'defeat', rank: { tier: 'gold', level: 2, progress: 18, change: -20 } }),
    rec({ rank: { tier: 'gold', level: 3, progress: 95, change: 21 } }),
    ...Array.from({ length: 8 }, (_, i) => rec({ result: i < 5 ? 'victory' : 'defeat' })),
    ...Array.from({ length: 3 }, (_, i) => rec({ hero: 'ana', result: i < 1 ? 'victory' : 'defeat' })),
  ]
}

// The same 60% held across three divisions of climb: the fitted slope is
// ~0 with a CI whose LOWER bound sits under the model's 0.5 pts/division
// floor — the "your history is still consistent with an improver" case,
// where no top can honestly be quoted.
function climbBandLevel(i: number): number {
  if (i < 20) return 2
  if (i < 40) return 3
  return 5
}

function flatSlopeCorpus(): MatchRecord[] {
  seq = 0
  const rows: MatchRecord[] = []
  for (let i = 0; i < 60; i++) {
    const win = i % 10 < 6
    const level = climbBandLevel(i)
    rows.push(rec({
      result: win ? 'victory' : 'defeat',
      rank: { tier: 'gold', level, progress: 50, change: win ? 20 : -20 },
    }))
  }
  // rec() walks BACKWARD in time, so reverse to make the highest rank newest.
  return rows.reverse()
}

const heroRole = (): string => 'support'
const mapGameMode = (): string => 'control'

function mountPanel(records: MatchRecord[], edit?: (calc: EloCalculator) => void): void {
  const calc = useEloCalculator({ records, heroRole, mapGameMode })
  edit?.(calc)
  const host = defineComponent({
    setup() {
      provideEloCalculator(calc)
      return () => h(EloResultsPanel as Component)
    },
  })
  render(host)
}

describe('EloResultsPanel — the two futures', () => {
  it('renders nothing until the form has a rate to project', () => {
    // Three drawn games: a rank to seed from, but no decisive record, so
    // there is no win rate and therefore no projection input at all.
    seq = 0
    mountPanel([
      rec({ result: 'draw', rank: { tier: 'gold', level: 2, progress: 40 } }),
      rec({ result: 'draw' }),
    ])
    expect(screen.queryByText('If your wins keep coming')).not.toBeInTheDocument()
    expect(screen.queryByText('The honest timeline')).not.toBeInTheDocument()
  })

  it('calls a target at the current rank "Already there" in both futures', () => {
    mountPanel(basicCorpus(), (calc) => {
      calc.editInput('currentProgress', 0)
      calc.editInput('targetTier', 'gold')
      calc.editInput('targetDivision', 2)
    })
    expect(screen.getAllByText('Already there')).toHaveLength(2)
  })

  it('treats a target BELOW the current rank as already there, not out of reach', () => {
    // The verdict card already reads a descent as "you're there"; the
    // futures only tested for exact equality, so picking a lower target
    // told a 57%-win-rate player their climb was "Out of reach" and that
    // "a losing record settles below the target" — on the same screen.
    mountPanel(basicCorpus(), (calc) => {
      calc.editInput('targetTier', 'gold')
      calc.editInput('targetDivision', 4)
    })
    expect(screen.getAllByText('Already there')).toHaveLength(2)
    expect(screen.queryByText('Out of reach')).not.toBeInTheDocument()
    expect(screen.queryByText(/A losing record settles below the target/)).not.toBeInTheDocument()
  })

  it('prices the climb in games, weeks, and its best/unlucky spread', () => {
    mountPanel(basicCorpus())
    expect(screen.getByText('~54 games')).toBeInTheDocument() // steady win rate
    expect(screen.getByText('~66 games')).toBeInTheDocument() // tougher lobbies
    expect(screen.getByText(/Best case ~14; with a sample of 14 games, a cold streak can't be ruled out/)).toBeInTheDocument()
    expect(screen.getByText('≈ 3.8 weeks at your pace')).toBeInTheDocument()
    expect(screen.getByText(/An upper bound — it assumes matchmaking never stiffens/)).toBeInTheDocument()
  })

  it('drops the pace line when no games-per-week is known', () => {
    mountPanel(basicCorpus(), (calc) => calc.editInput('gamesPerWeekInput', null))
    expect(screen.getByText('~54 games')).toBeInTheDocument()
    expect(screen.queryByText(/at your pace/)).not.toBeInTheDocument()
  })

  it('quotes the ceiling as a range when the rate clears the plateau', () => {
    mountPanel(basicCorpus())
    expect(screen.getByText('A bit slower, but 57.1% is high enough to break through.')).toBeInTheDocument()
    // 14 games buy an enormous credible envelope — quoting a point rank
    // here is exactly the overclaim the range replaced.
    // One tier lower in NAME than before Emerald: the same ladder score now
    // sits under an extra tier, which is the redistribution showing through.
    expect(screen.getByText('Your ceiling right now: Bronze 1–Diamond 4.')).toBeInTheDocument()
  })

  it('says the ceiling is undetectable rather than naming a top the slope CI cannot bound', () => {
    mountPanel(flatSlopeCorpus())
    expect(screen.getByText('Your ceiling right now: Silver 4 or higher — no hard ceiling is detectable yet.')).toBeInTheDocument()
  })

  it('below break-even, the climb is out of reach and the decay card prices the rate that holds the target', () => {
    mountPanel(basicCorpus(), (calc) => calc.editInput('winRatePct', 45))
    expect(screen.getByText('Out of reach')).toBeInTheDocument()
    expect(screen.getByText('Below 50%, extra games slowly cost you rank instead of gaining it.')).toBeInTheDocument()
    expect(screen.getByText('Levels off near Bronze 3–Emerald 2')).toBeInTheDocument()
    // The required rate is the ASYMPTOTE — it holds the rank, it doesn't pass it.
    expect(screen.getByText('To make Platinum 5 your plateau, win about 52.4% — passing it takes a bit more.')).toBeInTheDocument()
  })

  it('never pairs "levels off near" with an open-top ceiling range', () => {
    // "Levels off near Silver 4 or higher — no hard ceiling" contradicts
    // itself in one line; the head says only the second half.
    mountPanel(flatSlopeCorpus(), (calc) => calc.editInput('winRatePct', 50.5))
    expect(screen.getByText('No hard ceiling detectable yet')).toBeInTheDocument()
    expect(screen.queryByText(/Levels off near/)).not.toBeInTheDocument()
    expect(screen.getByText('Tougher lobbies pull you level here at your current form.')).toBeInTheDocument()
  })
})

describe('EloResultsPanel — the honest timeline', () => {
  it('quotes the simulated spread and omits the slowest tenth when it never arrives', () => {
    mountPanel(basicCorpus())
    const line = screen.getByText(/Across 4,000 simulated seasons/)
    expect(line).toHaveTextContent('the fastest tenth touch Platinum 5 by ~18 games · the median by ~76')
    expect(line).toHaveTextContent('36% never arrive within ~168 games')
    expect(line).not.toHaveTextContent('the slowest tenth')
  })

  it('reports the slowest tenth once the simulation resolves it', () => {
    mountPanel(flatSlopeCorpus())
    expect(screen.getByText(/the slowest tenth by ~222/)).toBeInTheDocument()
  })

  it('drops the never-arrive clause when effectively every season gets there', () => {
    // 65% over 400 games two divisions out: the posterior is tight enough
    // that the never-arrive tail rounds to nothing, and "0% never arrive"
    // would be noise dressed as a caveat.
    mountPanel(basicCorpus(), (calc) => {
      calc.editInput('winRatePct', 65)
      calc.editInput('sampleN', 400)
    })
    expect(screen.getByText(
      /^Across 4,000 simulated seasons: the fastest tenth touch Platinum 5 by ~\d+ games · the median by ~\d+ · the slowest tenth by ~\d+\.$/,
    )).toBeInTheDocument()
  })

  it('says nobody arrives instead of quoting a median that never happened', () => {
    mountPanel(basicCorpus(), (calc) => calc.editInput('winRatePct', 45))
    expect(screen.getByText(/^In \d+% of 4,000 simulated seasons you never touch Platinum 5 within ~168 games at this form\./))
      .toBeInTheDocument()
    expect(screen.queryByText(/the median by/)).not.toBeInTheDocument()
  })

  it('prices certainty in games, and stops charging for it once the sample pins the rate', () => {
    mountPanel(basicCorpus())
    expect(screen.getByText('Certainty has a price: ≈1030 more decisive games to pin your true win rate within ±3 points.'))
      .toBeInTheDocument()

    mountPanel(basicCorpus(), (calc) => calc.editInput('sampleN', 3000))
    expect(screen.getByText('Your sample already pins your true win rate within ±3 points.')).toBeInTheDocument()
  })
})
