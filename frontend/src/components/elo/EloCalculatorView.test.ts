import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import EloCalculatorView from '@/components/elo/EloCalculatorView.vue'
import type { MatchRecord } from '@/api-client'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The Elo tab, through its real provider.
//
// Every panel on this tab injects the calculator EloCalculatorView provides,
// and that key is module-private on purpose — so the honest way to test any
// of them is to mount the view over a seeded corpus and read what the panels
// say. Which is also the only way to catch the failure that matters here: a
// panel that renders a number the calculator never produced.
//
// These thirteen components shipped with no test at all (280 uncovered
// branches). See "No SFC ships without a unit test" in frontend/CLAUDE.md.

// ECharts paints to a canvas happy-dom cannot give it a 2D context for,
// and the canvas is opaque to every query anyway — the same stub the trends
// charts use. What the projection chart owns is the option it hands down,
// which its own panel test can assert; here it just has to not throw.
vi.mock('vue-echarts', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'VChartStub',
      props: { option: { type: Object, default: () => ({}) }, theme: { type: String, default: '' } },
      setup: () => () => h('div', { 'data-chart-stub': '' }),
    }),
  }
})

interface RecOpts {
  key: string
  result?: string
  hero?: string
  role?: string
  date?: string
  tier?: string
  division?: number
  hidden?: boolean
  source?: string
}

function rec(o: RecOpts): MatchRecord {
  return {
    match_key: o.key,
    source_files: [`${o.key}.png`],
    source_types: { [`${o.key}.png`]: 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'escort',
      role: o.role ?? 'support', hero: o.hero ?? 'ana',
      result: o.result ?? 'victory',
      date: o.date ?? '2026-05-10', finished_at: '20:00',
      eliminations: 18, assists: 9, deaths: 5,
      ...(o.tier ? { rank: `${o.tier} ${o.division ?? 3}` } : {}),
    },
    ...(o.hidden ? { hidden: true } : {}),
    ...(o.source ? { source: o.source } : {}),
    parsed_at: `${o.date ?? '2026-05-10'}T20:00:00Z`,
  } as unknown as MatchRecord
}

// A ranked support corpus with a real win rate: 12 wins, 8 losses.
function corpus(): MatchRecord[] {
  return Array.from({ length: 20 }, (_, i) => rec({
    key: `m${i}`,
    result: i < 12 ? 'victory' : 'defeat',
    date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
    tier: 'gold',
  }))
}

function renderElo(records: MatchRecord[] = corpus()) {
  setActivePinia(createPinia())
  seedQuery(qk.matches, records)
  return render(EloCalculatorView)
}

const panel = () => screen.getByRole('tabpanel')

describe('EloCalculatorView', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('is the tab panel the masthead points at', () => {
    renderElo()
    expect(panel()).toHaveAttribute('aria-labelledby', 'tab-elo')
  })

  // EloTrackPicker: one button per rank track, the active one pressed, and
  // a track with no games disabled rather than silently empty.
  describe('the track picker', () => {
    it('offers every track and marks the live one', () => {
      renderElo()
      const tracks = screen.getByRole('group', { name: 'Rank track' })
      const buttons = within(tracks).getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(1)
      expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    })

    it('disables a track the player has never queued, and says why', () => {
      renderElo()
      const tracks = screen.getByRole('group', { name: 'Rank track' })
      const dead = within(tracks).getAllByRole('button').filter((b) => b.hasAttribute('disabled'))
      expect(dead.length).toBeGreaterThan(0)
      expect(dead[0]).toHaveAttribute('title', 'No competitive games on this track yet')
    })

    it('switching a track keeps exactly one pressed', async () => {
      renderElo()
      const tracks = screen.getByRole('group', { name: 'Rank track' })
      const live = within(tracks).getAllByRole('button').filter((b) => !b.hasAttribute('disabled'))
      if (live.length > 1) {
        await fireEvent.click(live[1]!)
        const pressed = within(tracks).getAllByRole('button')
          .filter((b) => b.getAttribute('aria-pressed') === 'true')
        expect(pressed).toHaveLength(1)
      }
    })
  })

  // The corpus filter is a claim about whose play this tab describes, and
  // it is the one thing on the tab that cannot be re-derived by eye.
  describe('whose play it describes', () => {
    it('leaves out a match the player hid', () => {
      const withHidden = [...corpus(), rec({ key: 'hid', result: 'defeat', hidden: true, tier: 'gold' })]
      renderElo(withHidden)
      // 20 decisive games, not 21 — the hidden one is out.
      expect(panel()).toHaveTextContent(/20/)
    })

    // A coach's replay match carries the result the COACH typed. Letting it
    // move a win rate would let a coaching session rewrite the player's
    // evidence about their own play.
    it('leaves out a match a coach created from a replay', () => {
      const withReplay = [...corpus(), rec({ key: 'rep', result: 'defeat', source: 'replay', tier: 'gold' })]
      renderElo(withReplay)
      expect(panel()).toHaveTextContent(/20/)
    })
  })

  // An empty corpus is the first-run state, and every panel has to survive
  // it without printing a rate off nothing.
  it('stands up on an empty corpus without inventing a number', () => {
    renderElo([])
    expect(panel()).toBeInTheDocument()
    expect(panel()).not.toHaveTextContent('NaN')
    expect(panel()).not.toHaveTextContent('Infinity')
    expect(panel()).not.toHaveTextContent('undefined')
  })

  it('stands up on a corpus with no ranked games at all', () => {
    renderElo([rec({ key: 'q1', result: 'victory' }), rec({ key: 'q2', result: 'defeat' })])
    expect(panel()).toBeInTheDocument()
    expect(panel()).not.toHaveTextContent('NaN')
  })

  // A draw is not a loss. An all-draws corpus has no rate to report, and 0%
  // would read as "you lost every game".
  it('reports no rate rather than 0% when nothing was decided', () => {
    renderElo(Array.from({ length: 6 }, (_, i) => rec({ key: `d${i}`, result: 'draw', tier: 'gold' })))
    expect(panel()).not.toHaveTextContent('NaN')
    expect(panel()).not.toHaveTextContent('0%')
  })
})
