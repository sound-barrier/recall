import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import MatchCardExpanded from '@/components/matches/detail/MatchCardExpanded.vue'
import type { MatchRecord } from '@/api'

// The nested MatchJournal now writes annotations store-direct through
// useMatchActions (for the saved-pulse persistence receipt). These tests
// pin MatchCardExpanded's own contract, so stub the action layer rather
// than standing up Pinia + the api seam.
vi.mock('@/composables/matches/useMatchActions', () => ({
  useMatchActions: () => ({
    onSetMatchAnnotation: vi.fn().mockResolvedValue(true),
  }),
}))

// MatchCardExpanded owns annotation draft state, the leaver-chooser
// chips, heroes-played collapse, and the sources block. These tests
// pin the externally-observable contract: emits + render branches.

function makeRecord(over: Partial<MatchRecord['data']> = {}, top: Partial<MatchRecord> = {}): MatchRecord {
  return {
    match_key: 'match-2026-05-10T22-21-11',
    source_files: ['a.png'],
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'victory',
      date: '2026-05-10', finished_at: '22:21',
      eliminations: 17, assists: 12, deaths: 8, damage: 8500,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:25' }],
      ...over,
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...top,
  }
}

function renderCard(over: { record?: MatchRecord; isSourcesOpen?: boolean } = {}) {
  return render(MatchCardExpanded, {
    props: {
      record: over.record ?? makeRecord(),
      isSourcesOpen: over.isSourcesOpen ?? false,
      isPreviewOpen:   () => false,
      hasPreviewError: () => false,
      isActive: () => false,
    },
  })
}

describe('MatchCardExpanded — stats grid', () => {
  it('renders six stat cells in the match-stats grid', () => {
    renderCard()
    // Eliminations, Assists, Deaths, Damage, Healing, Mitigation —
    // each an EditableStat whose trigger is labeled "<Stat>: <value>.
    // Click to edit."
    expect(screen.getAllByRole('button', { name: /Click to edit/ }).length).toBeGreaterThanOrEqual(6)
  })

  it('shows the eliminations + assists numeric values', () => {
    renderCard()
    expect(screen.getByText('17')).toBeInTheDocument() // eliminations
    expect(screen.getByText('12')).toBeInTheDocument() // assists
    // Damage is formatted with thousands separator on render
    // (`8,500`), so assert the leading digit.
    expect(screen.getByText(/8[,.]?5/)).toBeInTheDocument()
  })
})

describe('MatchCardExpanded — disruption chips', () => {
  // Two choosers are mounted (leavers, then throwers), each with three side
  // chips. They are independent multi-select toggles, so the payload is the
  // full side SET the chooser wants — picking a second side ADDS to it rather
  // than replacing the first, which is what the old single-value column
  // couldn't express.
  const user = () => userEvent.setup()

  it('emits the leavers set when a side chip is clicked from an untagged record', async () => {
    const { emitted } = renderCard()
    expect(screen.getByRole('button', { name: /Ally left/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enemy left/ })).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: /I left/ }))
    const e = emitted('set-disruption')
    expect(e[0]).toEqual(['match-2026-05-10T22-21-11', 'leavers', ['self']])
  })

  it('adds a second side rather than replacing the first', async () => {
    const rec = makeRecord({}, { annotation: { leavers: ['team'], throwers: [] } } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    await user().click(screen.getByRole('button', { name: /I left/ }))
    expect(emitted('set-disruption')[0]).toEqual([rec.match_key, 'leavers', ['team', 'self']])
  })

  it('removes a side when its already-active chip is re-clicked', async () => {
    const rec = makeRecord({}, { annotation: { leavers: ['self', 'team'], throwers: [] } } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    await user().click(screen.getByRole('button', { name: /I left/ }))
    expect(emitted('set-disruption')[0]).toEqual([rec.match_key, 'leavers', ['team']])
  })

  it('keeps the thrower chooser independent of the leaver one', async () => {
    const rec = makeRecord({}, { annotation: { leavers: ['team'], throwers: [] } } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: rec })
    await user().click(screen.getByRole('button', { name: /Enemy threw/ }))
    expect(emitted('set-disruption')[0]).toEqual([rec.match_key, 'throwers', ['enemy']])
  })

  it('marks only the active side chips with aria-pressed="true"', () => {
    const rec = makeRecord({}, { annotation: { leavers: ['team'], throwers: ['enemy'] } } as unknown as Partial<MatchRecord>)
    renderCard({ record: rec })
    expect(screen.getByRole('button', { name: /I left/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Ally left/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Enemy left/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Enemy threw/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Ally threw/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('MatchCardExpanded — heroes played toggle', () => {
  it('renders the heroes-played list initially expanded', () => {
    renderCard()
    // heroesExpanded starts true; the hero entry should be present.
    expect(screen.getAllByText(/lucio/).length).toBeGreaterThan(0)
  })
})

describe('MatchCardExpanded — sources block', () => {
  it('renders the sources block only when isSourcesOpen is true', () => {
    renderCard({ isSourcesOpen: false })
    // The source-file list is only mounted when isSourcesOpen=true.
    expect(screen.queryByText(/a\.png/)).not.toBeInTheDocument()
  })

  it('shows the source filename in the open sources block', () => {
    renderCard({ isSourcesOpen: true })
    expect(screen.getByText(/a\.png/)).toBeInTheDocument()
  })
})

describe('MatchCardExpanded — since-this-match anchor toggle', () => {
  function renderAnchor(anchorKey?: string) {
    return render(MatchCardExpanded, {
      props: {
        record: makeRecord(),
        isSourcesOpen: false,
        isPreviewOpen:   () => false,
        hasPreviewError: () => false,
        isActive: () => false,
        anchorKey,
      },
    })
  }

  it('renders the anchor button with the idle copy when this match is NOT the anchor', () => {
    renderAnchor('some-other-match')
    // Action-first label ("Filter from this match") + plain-language
    // sublabel that names the consequence inline so a touch /
    // keyboard user doesn't depend on the tooltip.
    const btn = screen.getByRole('button', { name: /Filter from this match/i })
    expect(btn).toHaveTextContent(/marks this as your reference point/i)
    expect(btn).not.toHaveClass('is-anchor')
  })

  it('renders the anchor button with the active copy + class when this match IS the anchor', () => {
    renderAnchor('match-2026-05-10T22-21-11')
    const btn = screen.getByRole('button', { name: /Filtering from this match/i })
    expect(btn).toHaveClass('is-anchor')
    expect(btn).toHaveTextContent(/Reference set/i)
    expect(btn).toHaveTextContent(/click to clear/i)
    expect(btn).toHaveAttribute('data-anchor-set', 'true')
  })

  it('clicking when not the anchor emits set-anchor(matchKey)', async () => {
    const user = userEvent.setup()
    const { emitted } = renderAnchor('')
    await user.click(screen.getByRole('button', { name: /Filter from this match/i }))
    expect(emitted('set-anchor')).toBeTruthy()
    expect(emitted('set-anchor')[0]).toEqual(['match-2026-05-10T22-21-11'])
  })

  it('clicking when this match IS the anchor emits set-anchor("") to clear', async () => {
    const user = userEvent.setup()
    const { emitted } = renderAnchor('match-2026-05-10T22-21-11')
    await user.click(screen.getByRole('button', { name: /Filtering from this match/i }))
    expect(emitted('set-anchor')[0]).toEqual([''])
  })
})

// A hidden record can't surface in the detail panel (the panel's selection
// runs over the narrowed set, which excludes hidden), so the Unhide affordance
// is covered here at the card level where a hidden record mounts directly.
describe('MatchCardExpanded — soft-delete (hidden record)', () => {
  it('shows Unhide (not Hide) on a hidden record', () => {
    const hidden = makeRecord({}, { hidden: true } as unknown as Partial<MatchRecord>)
    renderCard({ record: hidden })
    expect(screen.getByRole('button', { name: /Unhide/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hide match/ })).not.toBeInTheDocument()
  })

  it('Unhide click emits set-match-hidden(match_key, false) — no confirm step', async () => {
    const user = userEvent.setup()
    const hidden = makeRecord({}, { hidden: true } as unknown as Partial<MatchRecord>)
    const { emitted } = renderCard({ record: hidden })
    await user.click(screen.getByRole('button', { name: /Unhide/ }))
    expect(emitted('set-match-hidden')[0]).toEqual([hidden.match_key, false])
  })
})
