import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import EloInputsPanel from '@/components/elo/EloInputsPanel.vue'
import {
  provideEloCalculator, useEloCalculator, type EloCalculator,
} from '@/composables/elo/useEloCalculator'
import { installMemoryLocalStorage } from '@/test-utils'

// The form the player fills in. Everything here runs the REAL calculator
// over a fixture corpus — the panel's job is to put the goal somewhere it
// survives a reload and to say, in words, whether the deadline holds.

let seq = 0
type Rank = { tier: string; level: number; progress: number; change?: number }

function rec(over: { result?: 'victory' | 'defeat'; rank?: Rank } = {}): MatchRecord {
  seq++
  const iso = new Date(Date.UTC(2026, 5, 30) - seq * 6 * 3_600_000).toISOString()
  return {
    match_key: `m${seq}`,
    queue_type: 'role',
    data: {
      playlist: 'competitive',
      hero: 'lucio',
      role: 'support',
      result: over.result ?? 'victory',
      date: iso.slice(0, 10),
      finished_at: iso.slice(11, 16),
      played_at_utc: iso,
      heroes_played: [{ hero: 'lucio', percent_played: 100 }],
      ...(over.rank
        ? { rank: over.rank.tier, level: over.rank.level, rank_progress: over.rank.progress, change_percent: over.rank.change }
        : {}),
    },
  } as unknown as MatchRecord
}

// 8W/6L at Gold 2, 40% — a real but modest climb rate.
function corpus(): MatchRecord[] {
  seq = 0
  return [
    rec({ rank: { tier: 'gold', level: 2, progress: 40, change: 22 } }),
    rec({ result: 'defeat', rank: { tier: 'gold', level: 2, progress: 18, change: -20 } }),
    rec({ rank: { tier: 'gold', level: 3, progress: 95, change: 21 } }),
    ...Array.from({ length: 8 }, (_, i) => rec({ result: i < 5 ? 'victory' : 'defeat' })),
    ...Array.from({ length: 3 }, (_, i) => rec({ result: i < 1 ? 'victory' : 'defeat' })),
  ]
}

const heroRole = (): string => 'support'
const mapGameMode = (): string => 'control'

// <input type="date"> commits on `change`, not `input` — fireEvent.update
// dispatches the latter for text-like inputs, so it would never reach the
// handler.
async function setDeadline(value: string): Promise<void> {
  await fireEvent.change(screen.getByLabelText('By'), { target: { value } })
}

function mountPanel(edit?: (calc: EloCalculator) => void): EloCalculator {
  const calc = useEloCalculator({ records: corpus(), heroRole, mapGameMode, seasons: [] })
  edit?.(calc)
  const host = defineComponent({
    setup() {
      provideEloCalculator(calc)
      return () => h(EloInputsPanel as Component)
    },
  })
  render(host)
  return calc
}

describe('EloInputsPanel', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T12:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('seeds the goal one tier above where the player sits', () => {
    mountPanel()
    expect(screen.getByLabelText('Tier', { selector: '[data-elo-target="tier"]' })).toHaveValue('platinum')
    expect(screen.getByLabelText('Division', { selector: '[data-elo-target="division"]' })).toHaveValue('5')
  })

  it('keeps the goal a player picks, deadline included', async () => {
    const calc = mountPanel()
    await fireEvent.update(screen.getByLabelText('Tier', { selector: '[data-elo-target="tier"]' }), 'diamond')
    await setDeadline('2026-12-01')

    expect(calc.targetTier.value).toBe('diamond')
    expect(calc.targetBy.value).toBe('2026-12-01')
    expect(localStorage.getItem('recall.elo.targetTier')).toBe('diamond')
    expect(localStorage.getItem('recall.elo.targetBy')).toBe('2026-12-01')
  })

  it('blames the inputs, not the goal, when there is nothing to project', async () => {
    // "Out of reach" is a verdict about the climb. Saying it because the
    // record is empty tells a player their goal is unattainable on no data.
    const calc = mountPanel()
    calc.editInput('sampleN', 0)
    await setDeadline('2029-01-01')
    expect(screen.getByText('Nothing to project')).toBeInTheDocument()
  })

  it('stays silent about pace until a deadline exists', () => {
    mountPanel()
    expect(screen.queryByText(/of play/)).not.toBeInTheDocument()
  })

  it('says how many weeks the goal needs against how many are left', async () => {
    mountPanel()
    await setDeadline('2029-01-01')
    expect(screen.getByText('On pace')).toBeInTheDocument()
    expect(screen.getByText(/weeks of play, 130\.8 weeks left\./)).toBeInTheDocument()

    await setDeadline('2026-07-07')
    expect(screen.getByText('Behind')).toBeInTheDocument()
    expect(screen.getByText(/weeks of play, 0\.9 weeks left\./)).toBeInTheDocument()

    // A date already gone is not "0 weeks left" — say what happened.
    await setDeadline('2026-06-01')
    expect(screen.getByText(/^That date has passed/)).toBeInTheDocument()
  })
})
