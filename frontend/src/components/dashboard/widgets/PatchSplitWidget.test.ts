import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/vue'
import type { MatchRecord } from '@/api-client'
import PatchSplitWidget from '@/components/dashboard/widgets/PatchSplitWidget.vue'
import { renderWidget } from '@/test-utils'

const PATCHES = [{ name: 'Season 4', at: '2026-08-11T19:00:00Z', note: 'Season start' }]

vi.mock('@/composables/shared/useOWData', () => ({
  useOWData: () => ({ patches: { value: PATCHES } }),
}))

function rec(date: string, result: string): MatchRecord {
  return {
    match_key: `m-${date}-${result}`,
    data: { date, finished_at: '20:00', result, played_at_utc: `${date}T20:00:00Z` },
  } as unknown as MatchRecord
}

describe('PatchSplitWidget', () => {
  it('names the patch it split on, so the comparison is attributable', () => {
    // Two numbers with no boundary named is an implication, not a finding.
    renderWidget(PatchSplitWidget, {
      dossier: { records: [rec('2026-08-01', 'victory'), rec('2026-08-20', 'defeat')] },
    })
    expect(screen.getByText('Around Season 4')).toBeInTheDocument()
  })

  it('shows the win rate on each side', () => {
    renderWidget(PatchSplitWidget, {
      dossier: {
        records: [
          rec('2026-08-01', 'victory'), rec('2026-08-02', 'victory'),
          rec('2026-08-20', 'defeat'),
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]!).getByText('100%')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('0%')).toBeInTheDocument()
  })

  it('says no patch landed rather than inventing a boundary', () => {
    renderWidget(PatchSplitWidget, { dossier: { records: [rec('2026-01-01', 'victory')] } })
    expect(screen.getByText('No patch has landed in this set.')).toBeInTheDocument()
  })

  it('shows a side with no decisive games as no games', () => {
    renderWidget(PatchSplitWidget, { dossier: { records: [rec('2026-08-20', 'victory')] } })
    expect(screen.getByText('no games')).toBeInTheDocument()
  })
})
