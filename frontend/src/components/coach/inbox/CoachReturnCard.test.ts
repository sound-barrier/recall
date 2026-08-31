import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import CoachReturnCard from '@/components/coach/inbox/CoachReturnCard.vue'
import type { CoachReturnItem } from '@/api-client'

function item(over: Partial<CoachReturnItem> = {}): CoachReturnItem {
  return {
    note_id: 'n-1',
    match_key: 'match-2026-08-13T22-30-00',
    kind: 'note',
    text: 'Hold the high ground until the second bubble.',
    focus_tags: ['positioning'],
    extra_tags: [],
    match_clock: '04:12',
    status: 'pending',
    match: { map: 'numbani', hero: 'ana', result: 'victory', date: '2026-08-21', finished_at: '22:30' },
    moments: [],
    ...over,
  } as CoachReturnItem
}

const renderCard = (over: Partial<CoachReturnItem> = {}, verdict: '' | 'accepted' | 'skipped' = '') =>
  render(CoachReturnCard, { props: { note: item(over), verdict } })

describe('CoachReturnCard', () => {
  it("shows what the coach wrote, in the app's date language", () => {
    renderCard()
    expect(screen.getByText('Hold the high ground until the second bubble.')).toBeInTheDocument()
    expect(screen.getByText(/numbani · ana · victory/)).toBeInTheDocument()
  })

  it("renders a coach's emphasis in a moment, not literal asterisks", () => {
    // This card is the FIRST place the player sees these moments — before
    // accepting. Asterisks here and clean text after accepting would be the
    // same words rendering two ways.
    renderCard({ moments: [{ moment_id: 'm1', match_clock: '03:23', text: '**do not** peek there' }] })
    expect(screen.getByText('do not')).toBeInTheDocument()
    expect(screen.queryByText(/\*\*do not\*\*/)).not.toBeInTheDocument()
  })

  it('escapes a moment rather than letting it carry markup', () => {
    renderCard({ moments: [{ moment_id: 'm1', match_clock: '03:23', text: '<img src=x onerror="window.pwned = true">' }] })
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined()
  })

  it('names a match that is gone in words, not by its internal key', () => {
    renderCard({ match: undefined })
    expect(screen.getByText('A match no longer in your history')).toBeInTheDocument()
  })

  it('says Skip removes the note once it is already on the match', () => {
    // On an accepted note the same verdict UN-writes it, so the control must
    // not promise a no-op.
    renderCard({ status: 'accepted' })
    expect(screen.getByRole('radio', { name: 'Remove from the match' })).toBeInTheDocument()
  })

  it('offers a plain Skip while the note is not on the match yet', () => {
    renderCard()
    expect(screen.getByRole('radio', { name: 'Skip' })).toBeInTheDocument()
  })

  it('refuses to accept a note the server marked orphaned, and says why', () => {
    // Orphan is the SERVER's verdict (status), not something the card infers
    // from a missing snapshot — accepting one would have nowhere to write.
    renderCard({ status: 'orphan', match: undefined })
    const accept = screen.getByRole('radio', { name: 'Accept' })
    expect(accept).toBeDisabled()
    expect(accept).toHaveAttribute('title', 'This note has no match to land on.')
  })

  it('reports the verdict the reader picked', async () => {
    const { emitted } = renderCard()
    await fireEvent.click(screen.getByRole('radio', { name: 'Accept' }))
    expect((emitted('decide') as string[][])[0]).toEqual(['accepted'])
  })
})
