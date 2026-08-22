import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import CoachNoteEditor from '@/components/coach/notes/CoachNoteEditor.vue'
import { emptyDraft, type CoachNoteDraft } from '@/match/coach/coach-notes'
import { markdownField } from '@/test-utils'

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
    const note = await markdownField()
    expect(note).toHaveValue('Late peel on B.')
    await fireEvent.update(note, 'Hold high ground until the second bubble.')
    expect(lastUpdate(view).text).toBe('Hold high ground until the second bubble.')
    expect(lastUpdate(view).kind).toBe('note')
  })
})

describe('CoachNoteEditor — the in-match clock', () => {
  // The field takes DIGITS, never punctuation: a coach transcribing moments
  // off a replay was reaching for the colon key every single time. Typing
  // 4, 1, 2 walks 00:04 → 00:41 → 04:12, so the colon is never absent and
  // therefore never typed.
  function typeClock(el: HTMLElement, digits: string) {
    return Promise.all([...digits].map((key) => fireEvent.keyDown(el, { key })))
  }

  it('takes the digits and shapes the clock itself', async () => {
    const view = renderEditor()
    const clock = screen.getByRole('textbox', { name: /clock/i })
    for (const key of '412') await fireEvent.keyDown(clock, { key })
    expect(clock).toHaveValue('04:12')
    expect(lastUpdate(view).matchClock).toBe('04:12')
  })

  it('does nothing at all when the colon is pressed', async () => {
    renderEditor()
    const clock = screen.getByRole('textbox', { name: /clock/i })
    for (const key of '412') await fireEvent.keyDown(clock, { key })
    await fireEvent.keyDown(clock, { key: ':' })
    await fireEvent.keyDown(clock, { key: 'a' })
    expect(clock).toHaveValue('04:12')
  })

  // 07:52 is typed as 0,7,5,2 and passes through 00:75 on the way. The
  // half-typed value is marked invalid and never saved, and the moment it
  // parses it is both.
  it('will not save a value that is only half typed', async () => {
    const view = renderEditor()
    const clock = screen.getByRole('textbox', { name: /clock/i })
    await typeClock(clock, '075')
    expect(clock).toHaveValue('00:75')
    expect(clock).toHaveAttribute('aria-invalid', 'true')
    // Earlier keystrokes DID save — '00:00' and '00:07' are real clocks, and
    // the field showed them. What must never reach the draft is the value
    // that is not a clock at all.
    expect(lastUpdate(view).matchClock).not.toBe('00:75')
    expect(lastUpdate(view).matchClock).toBe('00:07')

    await fireEvent.keyDown(clock, { key: '2' })
    expect(clock).toHaveValue('07:52')
    expect(clock).not.toHaveAttribute('aria-invalid', 'true')
    expect(lastUpdate(view).matchClock).toBe('07:52')
  })

  it('nudges the half the caret is in, and only that half', async () => {
    const view = renderEditor({ matchClock: '04:12' })
    const clock = screen.getByRole('textbox', { name: /clock/i })

    ;(clock as HTMLInputElement).setSelectionRange(1, 1)
    await fireEvent.keyDown(clock, { key: 'ArrowUp' })
    expect(clock).toHaveValue('05:12')

    ;(clock as HTMLInputElement).setSelectionRange(4, 4)
    await fireEvent.keyDown(clock, { key: 'ArrowDown' })
    expect(clock).toHaveValue('05:11')
    expect(lastUpdate(view).matchClock).toBe('05:11')
  })

  // The note's clock is optional — "somewhere in this game" is a real thing
  // for a coach to mean — so there has to be a way back to no clock at all.
  it('lets the coach empty the clock again', async () => {
    const view = renderEditor({ matchClock: '00:04' })
    const clock = screen.getByRole('textbox', { name: /clock/i })
    await fireEvent.keyDown(clock, { key: 'Backspace' })
    expect(clock).toHaveValue('00:00')
    await fireEvent.keyDown(clock, { key: 'Backspace' })
    expect(clock).toHaveValue('')
    expect(lastUpdate(view).matchClock).toBe('')
  })

  it('re-reads the clock when a resumed session hydrates the note late', async () => {
    const view = renderEditor()
    expect(screen.getByRole('textbox', { name: /clock/i })).toHaveValue('')
    await view.rerender({ draft: { ...emptyDraft(), text: 'hydrated', matchClock: '06:40' } })
    expect(screen.getByRole('textbox', { name: /clock/i })).toHaveValue('06:40')
  })
})

// Moments strip already owns per match.
describe('CoachNoteEditor — the self voice is prose', () => {
  it('drops the clock and the tag chips when the matches are your own', async () => {
    renderEditor({}, { voice: 'your' })
    expect(screen.queryByLabelText('In-match clock')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Focus tags' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'positioning' })).not.toBeInTheDocument()
    // What stays: the prose, its toolbar, and the nothing-to-add switch.
    expect(await markdownField()).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Nothing to add' })).toBeInTheDocument()
  })

  it("keeps both for a coach's session", () => {
    renderEditor({}, { voice: 'their' })
    expect(screen.getByLabelText('In-match clock')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Focus tags' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
  })
})

// The toolbar's own behavior moved to NoteWriter.test.ts with the toolbar.
// What stays here is this editor's WIRING of it: the "Nothing to add" switch
// turning the tools off is a fact about the note, not about the writer.
describe('CoachNoteEditor — the switch and the toolbar', () => {
  it('turns the toolbar off while "Nothing to add" is on', () => {
    renderEditor({ kind: 'reviewed_only' }, { voice: 'your' })
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bulleted list' })).toBeDisabled()
  })

  it('leaves the tools on for an ordinary note', () => {
    renderEditor({ text: 'something' }, { voice: 'your' })
    expect(screen.getByRole('button', { name: 'Bold' })).toBeEnabled()
  })
})

describe('CoachNoteEditor — your own voice', () => {
  it('files no clock and no tags', () => {
    renderEditor({}, { voice: 'your' })
    expect(screen.queryByLabelText('In-match clock')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ult economy' })).not.toBeInTheDocument()
  })

  it('sheds a clock and tags a note picked up before the split', async () => {
    // Neither has a field on screen any more, so an edit is the only chance
    // to clear them — and a leftover clock on a reviewed_only kind is a
    // shape the server refuses, which would fail every autosave forever.
    const view = renderEditor({ text: 'peel', focusTags: ['positioning'], matchClock: '04:12' }, { voice: 'your' })
    await fireEvent.update(await markdownField(), 'peel earlier')
    expect(lastUpdate(view).focusTags).toEqual([])
    expect(lastUpdate(view).matchClock).toBe('')
  })
})

describe('CoachNoteEditor — the typing itself', () => {
  // macOS substitutes words as you type and shows a balloon over the field.
  // A note is prose, so the useful behavior is the opposite: underline what
  // looks wrong, offer alternatives on right-click, and never rewrite what
  // someone actually typed.
  // A focus tag is a filing label from a small vocabulary, not a sentence.
  // Underlining "ult_economy" is noise and correcting it is damage.
  it('leaves the tag field out of it', async () => {
    renderEditor()
    await fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    const tag = screen.getByRole('textbox', { name: 'New focus tag' })
    expect(tag).toHaveAttribute('spellcheck', 'false')
    expect(tag).toHaveAttribute('autocorrect', 'off')
  })
})
