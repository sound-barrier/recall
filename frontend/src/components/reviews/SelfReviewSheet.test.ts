import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import SelfReviewSheet from '@/components/reviews/SelfReviewSheet.vue'

function renderSheet(over: Record<string, unknown> = {}) {
  return render(SelfReviewSheet, {
    props: {
      title: '', wld: { w: 2, l: 1, d: 0 }, winRate: 67, focusTally: [{ tag: 'positioning', count: 2 }],
      notesLine: '2 notes · 1 moment', summary: '', ...over,
    },
  })
}

describe('SelfReviewSheet', () => {
  it('is the review sheet: a title to give it, the record, the summary, Finish and the way back', async () => {
    const { emitted } = renderSheet()
    expect(screen.getByRole('complementary', { name: 'Review sheet' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Review record' })).toHaveTextContent('2')
    expect(screen.getByText('67%')).toBeInTheDocument()
    // No focus tally: tags are a coach's filing system and the self note
    // carries none, so the tally half is off and only the count line stays.
    expect(screen.queryByText('positioning')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Focus tally' })).not.toBeInTheDocument()
    expect(screen.getByText('2 notes · 1 moment')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'T')
    expect(emitted()['update-title']?.at(-1)).toEqual(['T'])
    await user.type(screen.getByRole('textbox', { name: 'What to work on' }), 'S')
    expect(emitted()['update-summary']?.at(-1)).toEqual(['S'])
    await user.click(screen.getByRole('button', { name: '← Back to reviews' }))
    expect(emitted()['close']).toHaveLength(1)
  })

  // Finish on a nameless sitting nudges once for a name — the shelf card
  // otherwise falls back to a date nobody searches for — and the second
  // press goes through as asked. A named sitting finishes on the first.
  it('nudges once for a name, then finishes; a named sitting finishes at once', async () => {
    const { emitted } = renderSheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Finish review' }))
    expect(emitted()['finish']).toBeUndefined()
    expect(screen.getByText(/Give it a name so you can find it later/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish review' }))
    expect(emitted()['finish']).toHaveLength(1)
  })

  it('finishes a named sitting on the first press', async () => {
    const { emitted } = renderSheet({ title: 'Tuesday' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Finish review' }))
    expect(emitted()['finish']).toHaveLength(1)
  })

  it('says when the sitting was finished; going back leads and re-finishing is quiet', () => {
    renderSheet({ title: 'Tuesday', finishedAt: '2026-08-18T20:00:00Z' })
    expect(screen.getByText(/^Finished ·/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '← Back to reviews' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-finish' }))
      .toHaveAccessibleDescription(/nothing else changes/)
  })
})
