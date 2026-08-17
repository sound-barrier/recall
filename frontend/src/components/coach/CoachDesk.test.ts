import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import CoachDesk from '@/components/coach/CoachDesk.vue'
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

  it('says the reel is empty rather than showing a blank desk', () => {
    renderDesk({ record: null })
    expect(screen.getByText(/Pick a frame/)).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
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
