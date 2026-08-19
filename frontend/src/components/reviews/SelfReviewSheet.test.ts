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
  it('is the review sheet: a title to give it, the record, the tally, the summary, Finish and the way back', async () => {
    const { emitted } = renderSheet()
    expect(screen.getByRole('complementary', { name: 'Review sheet' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Review record' })).toHaveTextContent('2')
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('positioning')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'T')
    expect(emitted()['update-title']?.at(-1)).toEqual(['T'])
    await user.type(screen.getByRole('textbox', { name: 'What to work on' }), 'S')
    expect(emitted()['update-summary']?.at(-1)).toEqual(['S'])
    await user.click(screen.getByRole('button', { name: 'Finish review' }))
    expect(emitted()['finish']).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '← All reviews' }))
    expect(emitted()['close']).toHaveLength(1)
  })

  it('says when the sitting was finished, and offers to finish again', () => {
    renderSheet({ finishedAt: '2026-08-18T20:00:00Z' })
    expect(screen.getByText(/^Finished ·/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish review again' })).toBeInTheDocument()
  })
})
