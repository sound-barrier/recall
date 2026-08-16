import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import CoachNoteEditor from '@/components/coach/CoachNoteEditor.vue'
import { emptyDraft, type CoachNoteDraft } from '@/match/coach-notes'

const MATCH_KEY = 'match-2026-08-08T21-14-00'

function renderEditor(draft: Partial<CoachNoteDraft> = {}, props: Record<string, unknown> = {}) {
  return render(CoachNoteEditor, {
    props: { matchKey: MATCH_KEY, draft: { ...emptyDraft(), ...draft }, ...props },
  })
}

function lastUpdate(view: ReturnType<typeof renderEditor>): CoachNoteDraft {
  const updates = view.emitted('update') as CoachNoteDraft[][] | undefined
  expect(updates, 'an update was emitted').toBeTruthy()
  return updates![updates!.length - 1]![0]!
}

describe('CoachNoteEditor — focus chips', () => {
  it('offers the fixed vocabulary, unpressed, in human words', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: 'ult economy' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'target priority' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'mental' })).toBeInTheDocument()
  })

  it('presses a chip into the draft', async () => {
    const view = renderEditor()
    await fireEvent.click(screen.getByRole('button', { name: 'ult economy' }))
    expect(lastUpdate(view).focusTags).toEqual(['ult_economy'])
  })

  it('shows the draft its pressed chips and lets one go', async () => {
    const view = renderEditor({ focusTags: ['positioning'], text: 'peel' })
    expect(screen.getByRole('button', { name: 'positioning', pressed: true })).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'positioning' }))
    expect(lastUpdate(view).focusTags).toEqual([])
  })

  it('grows a freeform chip through "+ Add" and commits it on Enter', async () => {
    const view = renderEditor()
    await fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    const field = screen.getByRole('textbox', { name: 'New focus tag' })
    await fireEvent.update(field, 'tempo')
    await fireEvent.keyDown(field, { key: 'Enter' })
    expect(lastUpdate(view).extraTags).toEqual(['tempo'])
    expect(lastUpdate(view).focusTags).toEqual([])
  })

  it('ignores an empty freeform tag', async () => {
    const view = renderEditor()
    await fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    await fireEvent.keyDown(screen.getByRole('textbox', { name: 'New focus tag' }), { key: 'Enter' })
    expect(view.emitted('update')).toBeUndefined()
  })

  it('shows an extra tag the draft already carries, and drops it when pressed', async () => {
    const view = renderEditor({ extraTags: ['tempo'], text: 'note' })
    expect(screen.getByRole('button', { name: 'tempo', pressed: true })).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'tempo' }))
    expect(lastUpdate(view).extraTags).toEqual([])
  })
})

describe('CoachNoteEditor — the note', () => {
  it('shows the draft text and reports what the coach types', async () => {
    const view = renderEditor({ text: 'Late peel on B.' })
    const note = screen.getByRole('textbox', { name: 'Note' })
    expect(note).toHaveValue('Late peel on B.')
    await fireEvent.update(note, 'Hold high ground until the second bubble.')
    expect(lastUpdate(view).text).toBe('Hold high ground until the second bubble.')
    expect(lastUpdate(view).kind).toBe('note')
  })
})

describe('CoachNoteEditor — the in-match clock', () => {
  it('normalizes a valid clock into the draft', async () => {
    const view = renderEditor()
    await fireEvent.update(screen.getByRole('textbox', { name: /clock/i }), '4:12')
    expect(lastUpdate(view).matchClock).toBe('04:12')
  })

  it('explains an unparseable clock through its hint instead of saving it', async () => {
    const view = renderEditor()
    const clock = screen.getByRole('textbox', { name: /clock/i })
    await fireEvent.update(clock, '9:99')
    expect(clock).toHaveAttribute('aria-invalid', 'true')
    expect(view.emitted('update')).toBeUndefined()

    // The e2e follows aria-describedby by hand; here the resolved
    // description is the same contract, stated once.
    expect(clock).toHaveAccessibleDescription(/MM:SS/)
  })

  it('clears the invalid state once the clock parses', async () => {
    renderEditor()
    const clock = screen.getByRole('textbox', { name: /clock/i })
    await fireEvent.update(clock, '9:99')
    await fireEvent.update(clock, '09:59')
    expect(clock).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('lets the coach empty the clock again', async () => {
    const view = renderEditor({ matchClock: '06:40' })
    await fireEvent.update(screen.getByRole('textbox', { name: /clock/i }), '')
    expect(lastUpdate(view).matchClock).toBe('')
  })

  it('re-reads the clock when a resumed session hydrates the note late', async () => {
    const view = renderEditor()
    expect(screen.getByRole('textbox', { name: /clock/i })).toHaveValue('')
    await view.rerender({ draft: { ...emptyDraft(), text: 'hydrated', matchClock: '06:40' } })
    expect(screen.getByRole('textbox', { name: /clock/i })).toHaveValue('06:40')
  })

  it('leaves half-typed text alone while the draft is unchanged', async () => {
    renderEditor()
    const clock = screen.getByRole('textbox', { name: /clock/i })
    await fireEvent.update(clock, '9:9')
    expect(clock).toHaveValue('9:9')
  })

  it('keeps the clock exactly as the coach typed it when it already parses to the stored value', async () => {
    const view = renderEditor()
    const clock = screen.getByRole('textbox', { name: /clock/i })
    await fireEvent.update(clock, '4:12')
    await view.rerender({ draft: { ...emptyDraft(), matchClock: '04:12' } })
    expect(clock).toHaveValue('4:12')
  })

  it('re-reads the clock when the desk moves to another match', async () => {
    const view = renderEditor({ matchClock: '06:40' })
    expect(screen.getByRole('textbox', { name: /clock/i })).toHaveValue('06:40')
    await view.rerender({ matchKey: 'match-2026-08-07T20-05-00', draft: emptyDraft() })
    expect(screen.getByRole('textbox', { name: /clock/i })).toHaveValue('')
  })
})

describe('CoachNoteEditor — reviewed with nothing to add', () => {
  it('is a switch that reports the draft kind', () => {
    renderEditor({ kind: 'reviewed_only' })
    expect(screen.getByRole('switch', { name: 'Reviewed' })).toHaveAttribute('aria-checked', 'true')
  })

  it('turns an empty draft into a reviewed-only mark', async () => {
    const view = renderEditor()
    await fireEvent.click(screen.getByRole('switch', { name: 'Reviewed' }))
    expect(lastUpdate(view).kind).toBe('reviewed_only')
  })

  it('turns the mark back off', async () => {
    const view = renderEditor({ kind: 'reviewed_only' })
    await fireEvent.click(screen.getByRole('switch', { name: 'Reviewed' }))
    expect(lastUpdate(view).kind).toBe('note')
  })

  it('is unavailable, with a reason, once the note says something', () => {
    renderEditor({ text: 'Peel earlier.' })
    const toggle = screen.getByRole('switch', { name: 'Reviewed' })
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('title', expect.stringContaining('written note'))
  })
})

describe('CoachNoteEditor — moving and saving', () => {
  it('steps to the neighboring frames', async () => {
    const view = renderEditor({}, { hasPrev: true, hasNext: true })
    await fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(view.emitted('prev')).toHaveLength(1)
    expect(view.emitted('next')).toHaveLength(1)
  })

  it('disables the step that has nowhere to go', () => {
    renderEditor({}, { hasPrev: false, hasNext: true })
    expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next match' })).toBeEnabled()
  })

  it('speaks the autosave state through a status line', async () => {
    const view = renderEditor({}, { saveState: 'saving' })
    expect(screen.getByRole('status')).toHaveTextContent('Saving')
    await view.rerender({ saveState: 'saved' })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })
})

// A note the server will refuse is worse than no note: the coach types a
// paragraph, every keystroke fails with "Not saved" in 10 px mono, and the
// words are gone. When the room knows the save cannot land, the editor
// stops accepting the typing and says why instead.
describe('CoachNoteEditor — blocked from saving', () => {
  const REASON = 'Say who this bundle is about before writing notes.'

  it('refuses the typing and gives the reason', () => {
    renderEditor({}, { blockedReason: REASON })
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'In-match clock' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'positioning' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Reviewed' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(REASON)
  })

  it('takes the typing again once the block lifts', async () => {
    const view = renderEditor({}, { blockedReason: REASON })
    await view.rerender({ blockedReason: '' })
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Autosaves as you write')
  })
})
