import { screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import type { FocusEntry } from '@/api'
import { setApiBacking } from '@/api-client'
import FocusNowWidget from '@/components/dashboard/widgets/FocusNowWidget.vue'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import { renderWidget } from '@/test-utils'

function entry(over: Partial<FocusEntry> = {}): FocusEntry {
  return { item_id: 'i', text: 't', status: 'working', source: 'self', from: '2026-08-18', ...over }
}

function seed(entries: FocusEntry[]) {
  setApiBacking({ ListFocus: vi.fn(async () => entries) })
  getQueryClient().setQueryData(qk.focus, entries)
  return renderWidget(FocusNowWidget, { dossier: {} })
}

describe('FocusNowWidget', () => {
  it('shows the top three, coach items first, and says who said each', async () => {
    seed([
      entry({ item_id: '1', text: 'hold the angle', source: 'coach', coach_name: 'Ordo', status: 'new' }),
      entry({ item_id: '2', text: 'ult economy' }),
      entry({ item_id: '3', text: 'call the dive' }),
      entry({ item_id: '4', text: 'fourth' }),
    ])
    await new Promise((r) => setTimeout(r, 0))

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('hold the angle')
    expect(rows[0]).toHaveTextContent('Ordo')
    expect(rows[1]).toHaveTextContent('you')
    expect(screen.queryByText('fourth')).not.toBeInTheDocument()
  })

  it('leaves out what has been retired', async () => {
    seed([entry({ item_id: '1', text: 'live' }), entry({ item_id: '2', text: 'retired', status: 'done' })])
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('live')).toBeInTheDocument()
    expect(screen.queryByText('retired')).not.toBeInTheDocument()
  })

  it('says what to do when there is nothing yet', async () => {
    seed([])
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText(/finish a review, or open a coach's notes/i)).toBeInTheDocument()
  })

  it('renders emphasis a coach wrote, rather than literal asterisks', async () => {
    // Same grammar as the note it came from — the item is coach-written text
    // reaching the player, and it should read the way the coach wrote it.
    seed([entry({ item_id: '1', text: '**stop** dying on the flank', source: 'coach', coach_name: 'Ordo' })])
    expect(await screen.findByText('stop')).toBeInTheDocument()
    expect(screen.queryByText(/\*\*stop\*\*/)).not.toBeInTheDocument()
  })
})
