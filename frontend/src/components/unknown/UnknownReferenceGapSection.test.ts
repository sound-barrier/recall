import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import UnknownReferenceGapSection from '@/components/unknown/UnknownReferenceGapSection.vue'
import { useMatchesStore } from '@/stores/matches'
import { AcknowledgeReferenceGap, UnacknowledgeReferenceGap } from '@/api'
import type { MatchRecord } from '@/api'

vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

// Dismiss on a gap card is ACKNOWLEDGE-only: one click hides the
// warning, the disclosure lists what's hidden, and "Show again"
// restores — the match itself is never touched. These cases pin the
// active/acknowledged partition and the two api calls.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetMatchResults:           vi.fn(async () => []),
  AcknowledgeReferenceGap:   vi.fn(async () => undefined),
  UnacknowledgeReferenceGap: vi.fn(async () => undefined),
}))

afterEach(() => {
  vi.clearAllMocks()
})

function gapRecord(key: string, acked = false): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: { map: 'rialto', hero: '', hero_raw: 'Miyazaki' },
    ...(acked ? { reference_gap_acknowledged: true } : {}),
  }
}

function renderWith(records: MatchRecord[]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useMatchesStore().records = records
  return render(UnknownReferenceGapSection, { global: { plugins: [pinia] } })
}

describe('UnknownReferenceGapSection — acknowledge-only dismiss', () => {
  it('partitions cards: the heading counts active gaps, acknowledged wait behind the disclosure', () => {
    renderWith([gapRecord('match-a'), gapRecord('match-b', true)])

    expect(screen.getByRole('heading', { name: 'Reference data gaps — 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 acknowledged — show' })).toBeInTheDocument()
    // The acked card stays out of the DOM until the disclosure opens.
    expect(screen.queryByRole('button', { name: /Show the warning for match-b/ })).not.toBeInTheDocument()
  })

  it('Dismiss fires the acknowledge on one click — the action is reversible, no armed confirm', async () => {
    renderWith([gapRecord('match-a')])

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss the warning for match-a' }))
    expect(AcknowledgeReferenceGap).toHaveBeenCalledWith('match-a')
  })

  it('the disclosure reveals acknowledged cards and Show again restores one', async () => {
    renderWith([gapRecord('match-b', true)])

    await fireEvent.click(screen.getByRole('button', { name: '1 acknowledged — show' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Show the warning for match-b again' }))
    expect(UnacknowledgeReferenceGap).toHaveBeenCalledWith('match-b')
  })
})
