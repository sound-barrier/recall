import { describe, it, expect } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import EloHeroPicker from '@/components/elo/EloHeroPicker.vue'
import {
  provideEloCalculator, useEloCalculator, type EloCalculator,
} from '@/composables/elo/useEloCalculator'

// The picker drives the real calculator: a selection re-scopes the win
// rate every projection reads, and a nudge is a layered what-if that must
// never touch the measured sample. Both rules are only observable through
// the state the rows advertise, so the tests drive the buttons.

let seq = 0

function rec(over: { result?: 'victory' | 'defeat' | 'draw'; hero?: string } = {}): MatchRecord {
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
      rank: 'gold',
      level: 2,
      rank_progress: 40,
      change_percent: over.result === 'defeat' ? -20 : 20,
    },
  } as unknown as MatchRecord
}

// lucio 7W/4L (the pool main), ana 1W/2L (a noisy off-pool pick), juno
// 2W/0L (a perfect record, which pins the 100% nudge bound).
function corpus(): MatchRecord[] {
  seq = 0
  return [
    ...Array.from({ length: 11 }, (_, i) => rec({ result: i < 7 ? 'victory' : 'defeat' })),
    ...Array.from({ length: 3 }, (_, i) => rec({ hero: 'ana', result: i < 1 ? 'victory' : 'defeat' })),
    ...Array.from({ length: 2 }, () => rec({ hero: 'juno' })),
  ]
}

const heroRole = (): string => 'support'
const mapGameMode = (): string => 'control'

// The reference-data roster is empty under test, so heroDisplayName falls
// back to the stored key — row names read in lowercase.
const LUCIO_ROW = 'lucio pool 11x · 64%'
const ANA_ROW = 'ana off 3x · 33% n<5'
const JUNO_ROW = 'juno off 2x · 100% n<5'

function mountPicker(records: MatchRecord[]): EloCalculator {
  const calc = useEloCalculator({ records, heroRole, mapGameMode , seasons: [] })
  const host = defineComponent({
    setup() {
      provideEloCalculator(calc)
      return () => h(EloHeroPicker as Component)
    },
  })
  render(host)
  return calc
}

const row = (name: string): HTMLElement => screen.getByRole('button', { name })
const raise = (hero: string): HTMLElement => screen.getByRole('button', { name: `Raise ${hero} win rate 1 point` })
const lower = (hero: string): HTMLElement => screen.getByRole('button', { name: `Lower ${hero} win rate 1 point` })

describe('EloHeroPicker', () => {
  it('stays out of the way when the track has no heroes to pick', () => {
    mountPicker([])
    expect(screen.queryByRole('group', { name: 'Or use only certain heroes' })).not.toBeInTheDocument()
  })

  it('labels every row with its pool membership, record, and noisy-sample warning', () => {
    mountPicker(corpus())
    expect(row(LUCIO_ROW)).toBeInTheDocument()
    // Under five games the rate is flagged as noise, and the badge says
    // the hero is outside the measured pool.
    expect(row(ANA_ROW)).toBeInTheDocument()
    expect(screen.getAllByText('n<5')).toHaveLength(2) // ana + juno, not lucio
  })

  it('narrows the sample to the picked heroes and dead-ends the arrows outside it', async () => {
    mountPicker(corpus())
    expect(raise('ana')).toBeEnabled()

    await fireEvent.click(row(LUCIO_ROW))
    expect(row(LUCIO_ROW)).toHaveAttribute('aria-pressed', 'true')
    // ana's games are no longer in the sample, so nudging her can't move it.
    expect(raise('ana')).toBeDisabled()
    expect(lower('ana')).toBeDisabled()
    expect(raise('lucio')).toBeEnabled()

    await fireEvent.click(row(LUCIO_ROW))
    expect(row(LUCIO_ROW)).toHaveAttribute('aria-pressed', 'false')
    expect(raise('ana')).toBeEnabled()
  })

  it('flips the bulk buttons with the selection they would produce', async () => {
    mountPicker(corpus())
    const selectAll = screen.getByRole('button', { name: 'Select all' })
    const unselectAll = screen.getByRole('button', { name: 'Unselect all' })
    expect(unselectAll).toBeDisabled() // nothing selected yet
    expect(selectAll).toBeEnabled()

    await fireEvent.click(selectAll)
    for (const name of [LUCIO_ROW, ANA_ROW, JUNO_ROW]) {
      expect(row(name)).toHaveAttribute('aria-pressed', 'true')
    }
    expect(selectAll).toBeDisabled()
    expect(unselectAll).toBeEnabled()

    await fireEvent.click(unselectAll)
    expect(row(LUCIO_ROW)).toHaveAttribute('aria-pressed', 'false')
    expect(unselectAll).toBeDisabled()
  })

  it('saturates a nudge five points from the measured rate', async () => {
    mountPicker(corpus())
    for (let i = 0; i < 5; i++) await fireEvent.click(raise('lucio'))
    expect(row('lucio pool 11x · 64% → 69%')).toBeInTheDocument()
    expect(raise('lucio')).toBeDisabled()
    expect(screen.getByText('+5')).toBeInTheDocument()

    await fireEvent.click(lower('lucio'))
    expect(row('lucio pool 11x · 64% → 68%')).toBeInTheDocument()
    expect(raise('lucio')).toBeEnabled()
  })

  it('refuses to nudge a rate past 100%', async () => {
    mountPicker(corpus())
    expect(raise('juno')).toBeDisabled() // juno is already 2W/0L
    expect(lower('juno')).toBeEnabled()

    await fireEvent.click(lower('juno'))
    expect(row('juno off 2x · 100% → 99% n<5')).toBeInTheDocument()
    expect(raise('juno')).toBeEnabled()
  })

  it('announces the blended what-if by hero share and clears it on reset', async () => {
    const calc = mountPicker(corpus())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // lucio carries 11 of the 16 decisive games, so a 1-point nudge on him
    // moves the blend by 11/16 — not the whole point.
    await fireEvent.click(raise('lucio'))
    expect(screen.getByRole('status'))
      .toHaveTextContent('Blended what-if: 62.5% → 63.2% (+0.7 pts). Every projection above follows it.')
    // The dial moves the projection; it never rewrites the measured input.
    expect(calc.winRatePct.value).toBe(62.5)

    await fireEvent.click(screen.getByRole('button', { name: 'Reset nudges' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(row(LUCIO_ROW)).toBeInTheDocument() // back to the measured rate
  })

  it('reports a downward blend with its sign', async () => {
    mountPicker(corpus())
    await fireEvent.click(lower('lucio'))
    expect(screen.getByRole('status')).toHaveTextContent('Blended what-if: 62.5% → 61.8% (-0.7 pts).')
  })
})
