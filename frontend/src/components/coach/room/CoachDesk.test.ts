import { render, screen, fireEvent } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MatchRecord } from '@/api-client'
import CoachDesk from '@/components/coach/room/CoachDesk.vue'
import { emptyDraft } from '@/match/coach/coach-notes'
import { markdownField } from '@/test-utils'

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
  // NoteWriter reads the UI store to freeze the app while it is expanded.
  beforeEach(() => { setActivePinia(createPinia()) })

  it('puts the match on the desk with its note editor', async () => {
    renderDesk()
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "King's Row" })).toBeInTheDocument()
    expect(await markdownField()).toBeInTheDocument()
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

// The desk's take-this-match-out strip: a sitting's affordance, armed, and
// refused for the last frame and for a locked profile — each with the reason.
describe('CoachDesk — taking the match out of the review', () => {
  it('is absent on a coach loan (removable: none)', () => {
    renderDesk()
    expect(screen.queryByRole('button', { name: 'Take this match out of the review' })).not.toBeInTheDocument()
  })

  it('arms, re-arms per frame, and only the second press emits', async () => {
    const view = renderDesk({ removable: 'yes' })
    await fireEvent.click(screen.getByRole('button', { name: 'Take this match out of the review' }))
    expect(view.emitted()['remove-frame']).toBeUndefined()

    // A new frame under an armed button disarms it — the second click must
    // never land on a different match than the first asked about.
    await view.rerender({ record: { ...RECORD, match_key: 'match-2026-08-08T22-00-00' } })
    expect(screen.getByRole('button', { name: 'Take this match out of the review' })).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Take this match out of the review' }))
    await fireEvent.click(screen.getByRole('button', { name: /Take it out — its note and moments go with it/ }))
    expect(view.emitted()['remove-frame']).toHaveLength(1)
  })

  it('Keep it disarms without emitting', async () => {
    const view = renderDesk({ removable: 'yes' })
    await fireEvent.click(screen.getByRole('button', { name: 'Take this match out of the review' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(view.emitted()['remove-frame']).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Take this match out of the review' })).toBeInTheDocument()
  })

  it('refuses the last frame with the way out', () => {
    renderDesk({ removable: 'last' })
    const btn = screen.getByRole('button', { name: 'Take this match out of the review' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAccessibleDescription(/delete the review instead/)
  })

  it('a blocked reason outranks the last-frame reason', () => {
    renderDesk({ removable: 'yes', blockedReason: 'Writes are locked.' })
    const btn = screen.getByRole('button', { name: 'Take this match out of the review' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAccessibleDescription('Writes are locked.')
  })

  it("says the sitting's own empty line when every member left the history", () => {
    renderDesk({ record: null, reelEmpty: true, voice: 'your' })
    expect(screen.getByText(/None of the matches in this review are in your history/)).toBeInTheDocument()
  })
})
