import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import CoachDesk from '@/components/coach/room/CoachDesk.vue'
import { emptyDraft } from '@/match/coach/coach-notes'

const RECORD: MatchRecord = {
  match_key: 'match-2026-08-08T21-14-00',
  source_files: [],
  data: { map: "king's row", hero: 'ana', result: 'victory', date: '2026-08-08', finished_at: '21:14' },
}

function renderDesk(props: Record<string, unknown> = {}) {
  return render(CoachDesk, {
    props: { record: RECORD, handle: 'Sable', draft: emptyDraft(), ...props },
  })
}

describe('CoachDesk', () => {
  it('puts the match on the desk with its note editor', () => {
    renderDesk()
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "King's Row" })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
  })

  // Two empties, and they read differently. The desk used to show one line
  // for both, so a bundle with no matches at all told the coach to "pick a
  // frame from the reel" — pointing at an empty reel and asking them to
  // choose from it.
  it('asks for a pick when there are frames to pick from', () => {
    renderDesk({ record: null })
    expect(screen.getByText(/Pick a frame/)).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
  })

  it('says there is nothing to pick when the reel itself is empty', () => {
    renderDesk({ record: null, reelEmpty: true })
    expect(screen.getByText(/holds no matches to review/)).toBeInTheDocument()
    expect(screen.queryByText(/Pick a frame/)).not.toBeInTheDocument()
  })

  it("passes the coach's edits up with nothing added", async () => {
    const view = renderDesk()
    await fireEvent.click(screen.getByRole('button', { name: 'cooldowns' }))
    expect(view.emitted('update-note')).toEqual([[{ ...emptyDraft(), focusTags: ['cooldowns'] }]])
  })

  it('relays the prev/next steps', async () => {
    const view = renderDesk({ hasPrev: true, hasNext: true })
    await fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(view.emitted('prev')).toHaveLength(1)
    expect(view.emitted('next')).toHaveLength(1)
  })
})
