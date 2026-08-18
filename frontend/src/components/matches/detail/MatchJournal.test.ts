import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/vue'

import { createPinia, setActivePinia } from 'pinia'

import MatchJournal from '@/components/matches/detail/MatchJournal.vue'
import type { MatchRecord } from '@/api'
import type { SearchClause } from '@/match/search-query'

// The write gate reads the profiles query + the coaching-session store;
// these cases pin this component's own contract, so stub it open.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

type MatchAnnotation = NonNullable<MatchRecord['annotation']>

// MatchJournal writes annotations store-direct through useMatchActions so
// the "saved" pulse is a real persistence receipt. These tests pin the
// JOURNAL's own contract (which cell is rendered, what the keyboard does,
// what gets persisted), so stub the action layer rather than standing up
// Pinia + the api seam.
const onSetMatchAnnotation = vi.fn().mockResolvedValue(true)
const onSetMatchMoment = vi.fn().mockResolvedValue(true)
const onDeleteMatchMoment = vi.fn().mockResolvedValue(true)
const onCopyReplayCode = vi.fn().mockResolvedValue(undefined)
vi.mock('@/composables/matches/useMatchActions', () => ({
  useMatchActions: () => ({
    onSetMatchAnnotation, onSetMatchMoment, onDeleteMatchMoment, onCopyReplayCode,
  }),
}))

const KEY = 'match-2026-05-10T22-21-11'

function makeRecord(annotation?: Partial<MatchAnnotation>): MatchRecord {
  return {
    match_key: KEY,
    source_files: ['a.png'],
    data: { map: 'rialto', hero: 'lucio', result: 'victory', date: '2026-05-10' },
    parsed_at: '2026-05-10T22:30:00Z',
    ...(annotation ? { annotation: annotation as MatchAnnotation } : {}),
  }
}

interface JournalProps {
  record?: MatchRecord
  availableTags?: string[]
  pendingFocus?: '' | 'note' | 'tag'
  applySource?: Pick<MatchRecord, 'match_key' | 'annotation'> | null
  searchClauses?: SearchClause[]
}

function renderJournal(over: JournalProps = {}) {
  return render(MatchJournal, {
    props: {
      record: over.record ?? makeRecord(),
      availableTags: over.availableTags ?? [],
      pendingFocus: over.pendingFocus ?? '',
      applySource: over.applySource ?? null,
      ...(over.searchClauses ? { searchClauses: over.searchClauses } : {}),
    },
  })
}

// happy-dom's activeElement fails identity comparison against a queried
// element even when they serialize identically — compare ids.
const focusedId = () => document.activeElement?.id ?? ''
const tagInput = () => screen.getByRole('combobox')

beforeEach(() => {
  onSetMatchAnnotation.mockClear()
  onSetMatchMoment.mockClear()
  onDeleteMatchMoment.mockClear()
})

describe('MatchJournal — one-shot focus from the row context menu', () => {
  it('focuses the tag input when the menu asked for Tag', async () => {
    const { emitted } = renderJournal({ pendingFocus: 'tag' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(focusedId()).toBe(`tags-${KEY}`)
    // Consumed, so a re-render can't steal focus back off the user.
    expect(emitted('focus-consumed')).toHaveLength(1)
  })

  it('focuses the note textarea when the menu asked for Edit annotation', async () => {
    renderJournal({ pendingFocus: 'note' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(focusedId()).toBe(`note-${KEY}`)
  })

  it('focuses the note even when the match is ALREADY annotated', async () => {
    // Regression: an annotated match renders the read-only note PREVIEW,
    // not the textarea, so "Edit annotation" on exactly the matches worth
    // editing landed on an element that does not exist — the panel opened
    // with the caret nowhere.
    renderJournal({ record: makeRecord({ note: 'fed early, recovered' }), pendingFocus: 'note' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(focusedId()).toBe(`note-${KEY}`)
  })

  it('leaves focus alone when the panel was opened normally', async () => {
    renderJournal({ pendingFocus: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(focusedId()).toBe('')
  })
})

describe('MatchJournal — note cell', () => {
  it('starts in the textarea when there is nothing written yet', () => {
    // An empty note skips the preview so the first character costs no
    // extra click.
    renderJournal()
    expect(screen.getByLabelText('Note')).toHaveValue('')
    expect(screen.queryByRole('textbox', { name: 'Click to edit' })).not.toBeInTheDocument()
  })

  it('renders an annotated note as a read-only preview until it is activated', async () => {
    renderJournal({ record: makeRecord({ note: 'fed early, recovered' }) })
    const preview = screen.getByRole('textbox', { name: 'Click to edit' })
    expect(preview).toHaveAttribute('aria-readonly', 'true')

    await fireEvent.keyDown(preview, { key: 'Enter' })
    // Enter promotes the preview to the real editor — keyboard users get
    // the same click-to-edit affordance the mouse does.
    expect(screen.getByLabelText('Note')).toHaveValue('fed early, recovered')
  })

  it('persists the whole annotation set on blur, not just the note', async () => {
    // Every commit writes all five fields so a single-field setter can
    // never drop what the user typed in a sibling cell.
    renderJournal({ record: makeRecord({ tags: ['stack'], members: ['ana#1234'] }) })
    const note = screen.getByLabelText('Note')
    await fireEvent.update(note, 'threw it away')
    await fireEvent.blur(note)

    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({
      note: 'threw it away',
      tags: ['stack'],
      members: ['ana#1234'],
    }))
  })

  it('marks live search hits inside the note preview', () => {
    renderJournal({
      record: makeRecord({ note: 'lucio boop clutch' }),
      searchClauses: [{ field: 'note', value: 'boop' }],
    })
    expect(screen.getByText('boop')).toBeInTheDocument()
  })
})

describe('MatchJournal — status header', () => {
  it('reads AWAITING ENTRY on a blank journal and names itself empty', () => {
    renderJournal()
    expect(screen.getByRole('region', { name: 'Match journal — empty' })).toBeInTheDocument()
    expect(screen.getByText('AWAITING ENTRY')).toBeInTheDocument()
  })

  it('flips to LOGGED as soon as ANY field carries content', () => {
    // A replay code alone counts — the header is about "is there anything
    // here", not specifically a note.
    renderJournal({ record: makeRecord({ replay_code: '7H1K9P' }) })
    expect(screen.getByRole('region', { name: 'Match journal — has annotations' })).toBeInTheDocument()
    expect(screen.getByText('LOGGED')).toBeInTheDocument()
  })
})

describe('MatchJournal — apply the previous match annotation', () => {
  const SOURCE = {
    match_key: 'match-2026-05-10T21-40-00',
    annotation: { members: ['ana#1234', 'rein#5678'], tags: ['stack'] } as MatchAnnotation,
  }

  it('hides the affordance when there is no previous annotated match', () => {
    renderJournal({ applySource: null })
    expect(screen.queryByRole('button', { name: /^Apply members and tags/ })).not.toBeInTheDocument()
  })

  it('copies members and tags into the draft and offers Confirm / Undo', async () => {
    renderJournal({ applySource: SOURCE })
    await fireEvent.click(screen.getByRole('button', { name: `Apply members and tags from ${SOURCE.match_key}` }))

    expect(screen.getByRole('button', { name: 'Remove ana#1234 from group' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'stack' })).toHaveAttribute('aria-pressed', 'true')
    // Nothing is persisted until the user confirms.
    expect(onSetMatchAnnotation).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Confirm members and tags copied from/ })).toBeInTheDocument()
  })

  it('Undo restores the pre-apply draft without writing anything', async () => {
    renderJournal({ record: makeRecord({ members: ['zen#0001'] }), applySource: SOURCE })
    await fireEvent.click(screen.getByRole('button', { name: `Apply members and tags from ${SOURCE.match_key}` }))
    await fireEvent.click(screen.getByRole('button', { name: 'Undo the applied annotation' }))

    expect(screen.getByRole('button', { name: 'Remove zen#0001 from group' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove ana#1234 from group' })).not.toBeInTheDocument()
    expect(onSetMatchAnnotation).not.toHaveBeenCalled()
  })

  it('Confirm persists the copied set', async () => {
    renderJournal({ applySource: SOURCE })
    await fireEvent.click(screen.getByRole('button', { name: `Apply members and tags from ${SOURCE.match_key}` }))
    await fireEvent.click(screen.getByRole('button', { name: /^Confirm members and tags copied from/ }))

    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({
      members: ['ana#1234', 'rein#5678'],
      tags: ['stack'],
    }))
  })
})

describe('MatchJournal — group members', () => {
  it('Enter commits a BattleTag as a chip and persists it', async () => {
    renderJournal()
    const input = screen.getByLabelText(/^Group/)
    await fireEvent.update(input, 'ana#1234')
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByRole('button', { name: 'Remove ana#1234 from group' })).toBeInTheDocument()
    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({ members: ['ana#1234'] }))
  })

  it('refuses a duplicate BattleTag instead of adding a second chip', async () => {
    renderJournal({ record: makeRecord({ members: ['ana#1234'] }) })
    const input = screen.getByLabelText(/^Group/)
    await fireEvent.update(input, 'ana#1234')
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getAllByRole('button', { name: /from group$/ })).toHaveLength(1)
    expect(onSetMatchAnnotation).not.toHaveBeenCalled()
  })

  it('Backspace on an empty input pops the last chip', async () => {
    renderJournal({ record: makeRecord({ members: ['ana#1234', 'rein#5678'] }) })
    await fireEvent.keyDown(screen.getByLabelText(/^Group/), { key: 'Backspace' })

    expect(screen.queryByRole('button', { name: 'Remove rein#5678 from group' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove ana#1234 from group' })).toBeInTheDocument()
  })
})

describe('MatchJournal — tags', () => {
  it('exposes the three conventional tags as pressable toggles', async () => {
    renderJournal({ record: makeRecord({ tags: ['stack'] }) })
    expect(screen.getByRole('button', { name: 'stack' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'stream' })).toHaveAttribute('aria-pressed', 'false')

    await fireEvent.click(screen.getByRole('button', { name: 'stream' }))
    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({ tags: ['stack', 'stream'] }))
  })

  it('un-presses a conventional tag on re-click', async () => {
    renderJournal({ record: makeRecord({ tags: ['stack'] }) })
    await fireEvent.click(screen.getByRole('button', { name: 'stack' }))
    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({ tags: [] }))
  })

  it('renders a free-form tag as a removable chip, separate from the toggles', async () => {
    renderJournal({ record: makeRecord({ tags: ['tilted'] }) })
    await fireEvent.click(screen.getByRole('button', { name: 'Remove tilted tag' }))
    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({ tags: [] }))
  })
})

describe('MatchJournal — tag autocomplete', () => {
  const VOCAB = ['tilted', 'throw', 'comeback']

  it('reports itself collapsed until the input has focus AND suggestions', async () => {
    renderJournal({ availableTags: VOCAB })
    expect(tagInput()).toHaveAttribute('aria-expanded', 'false')

    await fireEvent.focus(tagInput())
    expect(tagInput()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox', { name: 'Tag suggestions' })).toBeInTheDocument()
  })

  it('prefix-matches the typed text — "t" surfaces tilted/throw, not comeback', async () => {
    renderJournal({ availableTags: VOCAB })
    await fireEvent.focus(tagInput())
    await fireEvent.update(tagInput(), 't')

    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map(o => o.textContent?.trim())).toEqual(['tilted', 'throw'])
  })

  it('hides a tag the match already carries', async () => {
    renderJournal({ record: makeRecord({ tags: ['tilted'] }), availableTags: VOCAB })
    await fireEvent.focus(tagInput())
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map(o => o.textContent?.trim())).toEqual(['throw', 'comeback'])
  })

  it('ArrowDown walks the list through aria-activedescendant and Enter adopts', async () => {
    renderJournal({ availableTags: VOCAB })
    await fireEvent.focus(tagInput())
    await fireEvent.keyDown(tagInput(), { key: 'ArrowDown' })
    expect(tagInput()).toHaveAttribute('aria-activedescendant', `tags-${KEY}-sug-0`)

    await fireEvent.keyDown(tagInput(), { key: 'ArrowDown' })
    expect(tagInput()).toHaveAttribute('aria-activedescendant', `tags-${KEY}-sug-1`)

    await fireEvent.keyDown(tagInput(), { key: 'Enter' })
    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({ tags: ['throw'] }))
  })

  it('ArrowUp from the first suggestion wraps to the last', async () => {
    renderJournal({ availableTags: VOCAB })
    await fireEvent.focus(tagInput())
    await fireEvent.keyDown(tagInput(), { key: 'ArrowDown' })
    await fireEvent.keyDown(tagInput(), { key: 'ArrowUp' })
    expect(tagInput()).toHaveAttribute('aria-activedescendant', `tags-${KEY}-sug-2`)
  })

  it('Enter with no highlighted suggestion commits the typed text as a custom tag', async () => {
    renderJournal({ availableTags: VOCAB })
    await fireEvent.focus(tagInput())
    await fireEvent.update(tagInput(), 'Griefed')
    await fireEvent.keyDown(tagInput(), { key: 'Enter' })
    // Normalized to lowercase so the optimistic UI matches what the
    // server round-trips.
    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({ tags: ['griefed'] }))
  })

  it('Escape collapses the list without adopting anything', async () => {
    renderJournal({ availableTags: VOCAB })
    await fireEvent.focus(tagInput())
    await fireEvent.keyDown(tagInput(), { key: 'ArrowDown' })
    await fireEvent.keyDown(tagInput(), { key: 'Escape' })

    expect(tagInput()).toHaveAttribute('aria-expanded', 'false')
    expect(tagInput()).not.toHaveAttribute('aria-activedescendant')
    expect(onSetMatchAnnotation).not.toHaveBeenCalled()
  })
})

describe('MatchJournal — replay code', () => {
  it('commits on Enter without waiting for a blur', async () => {
    renderJournal()
    const input = screen.getByLabelText('Replay code')
    await fireEvent.update(input, '7H1K9P')
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({ replay_code: '7H1K9P' }))
  })

  it('trims what the user pasted', async () => {
    renderJournal()
    const input = screen.getByLabelText('Replay code')
    await fireEvent.update(input, '  7H1K9P  ')
    await fireEvent.blur(input)
    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({ replay_code: '7H1K9P' }))
  })
})

describe('MatchJournal — note preview activation', () => {
  it('Space opens the editor the same way Enter does', async () => {
    renderJournal({ record: makeRecord({ note: 'fed early' }) })
    await fireEvent.keyDown(screen.getByRole('textbox', { name: 'Click to edit' }), { key: ' ' })
    expect(screen.getByLabelText('Note')).toHaveValue('fed early')
  })

  it('a click on the preview opens the editor', async () => {
    renderJournal({ record: makeRecord({ note: 'fed early' }) })
    await fireEvent.click(screen.getByRole('textbox', { name: 'Click to edit' }))
    expect(screen.getByLabelText('Note')).toHaveValue('fed early')
  })
})

describe('MatchJournal — adopting a suggestion by mouse', () => {
  it('takes the cursor on hover and adopts on press, keeping input focus', async () => {
    // mousedown.prevent (not click) is what stops the input blurring and
    // closing the list out from under the pointer.
    renderJournal({ availableTags: ['tilted', 'throw'] })
    await fireEvent.focus(tagInput())
    const [first, second] = within(screen.getByRole('listbox')).getAllByRole('option')

    await fireEvent.mouseEnter(second!)
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(first).toHaveAttribute('aria-selected', 'false')

    await fireEvent.mouseDown(second!)
    expect(onSetMatchAnnotation).toHaveBeenCalledWith(KEY, expect.objectContaining({ tags: ['throw'] }))
  })
})

describe('MatchJournal — the coach layer', () => {
  // CoachNoteBlock reaches the coach store for its Remove action.
  beforeEach(() => { setActivePinia(createPinia()) })

  const coachBlock = (over: Record<string, unknown> = {}) => ({
    id: 1,
    note_id: 'n-1',
    coach_name: 'Ordo',
    session_date: '2026-08-14',
    text: 'Late peel on B.',
    match_clock: '06:40',
    focus_tags: ['positioning'],
    extra_tags: [],
    accepted_at: '2026-08-15T09:15:00Z',
    ...over,
  })

  function withCoachNotes(notes: ReturnType<typeof coachBlock>[], note = 'my own read of it') {
    const record = makeRecord({ note })
    return { ...record, coach_notes: notes } as MatchRecord
  }

  it('renders one block per coach and never merges them into the player\'s note', () => {
    renderJournal({
      record: withCoachNotes([
        coachBlock(),
        coachBlock({ id: 2, note_id: 'n-2', coach_name: 'Vex', text: 'Different session.' }),
      ]),
    })
    expect(screen.getByRole('region', { name: "Coach's note from Ordo" })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: "Coach's note from Vex" })).toBeInTheDocument()
    // The player's own note is exactly where it was, untouched.
    expect(screen.getByText('my own read of it')).toBeInTheDocument()
  })

  it('renders no coach section on a match with no accepted notes', () => {
    renderJournal({ record: makeRecord({ note: 'mine only' }) })
    expect(screen.queryByRole('region', { name: /Coach's note/ })).toBeNull()
  })
})

describe('MatchJournal — the write gate', () => {
  // The journal renders the coach layer too, and "Remove this note" is a
  // write like any other — a default record carries no coach block, which
  // is exactly how this control stayed live under a lock that claimed to
  // cover "every field". Pinia is what CoachNoteBlock's store read needs.
  beforeEach(() => { resetWriteGate(); setActivePinia(createPinia()) })

  const withCoachBlock = () => ({
    ...makeRecord(),
    coach_notes: [{
      id: 1,
      note_id: 'n-1',
      coach_name: 'Ordo',
      session_date: '2026-08-14',
      text: 'Late peel on B.',
      match_clock: '06:40',
      focus_tags: ['positioning'],
      extra_tags: [],
      accepted_at: '2026-08-15T09:15:00Z',
    }],
  } as MatchRecord)

  it('disables every control on the surface while writes are locked', () => {
    setWritesLocked(true, { session: true })
    renderJournal({ record: withCoachBlock() })
    expect(screen.getByLabelText('Note')).toBeDisabled()
    expect(screen.getByLabelText('Replay code')).toBeDisabled()
    expect(tagInput()).toBeDisabled()
    for (const t of screen.getAllByRole('button', { pressed: false })) expect(t).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove this note' })).toBeDisabled()
  })

  it('leaves the coach block removable when writes are open', () => {
    renderJournal({ record: withCoachBlock() })
    expect(screen.getByRole('button', { name: 'Remove this note' })).toBeEnabled()
  })

  it('a locked note preview does not open the editor', async () => {
    setWritesLocked(true, { session: true })
    renderJournal({ record: makeRecord({ note: 'read only' }) })
    await fireEvent.click(screen.getByText('read only'))
    expect(screen.queryByLabelText('Note')).toBeNull()
  })
})


// The player's own cue strip, hosted in the journal.
//
// The strip is the coach's component reused, but the state around it is the
// journal's own: the record is the truth for anything saved, and a row still
// being typed lives here until the server takes it. Every case below is one
// the review found by reading that seam.
describe('the moments strip', () => {
  beforeEach(() => { resetWriteGate(); setActivePinia(createPinia()) })

  const moment = (id: string, clock: string, text: string) =>
    ({ moment_id: id, match_clock: clock, text })

  function withMoments(...ms: ReturnType<typeof moment>[]): MatchRecord {
    return { ...makeRecord(), moments: ms } as MatchRecord
  }

  const strip = () => screen.getByRole('region', { name: 'Moments' })
  const row = (n: number, of: number) =>
    within(strip()).getByRole('group', { name: new RegExp(`Moment ${n} of ${of}`) })

  it('holds a saved moment being retyped instead of reverting it', async () => {
    renderJournal({ record: withMoments(moment('a', '03:23', 'first words')) })

    const text = within(row(1, 1)).getByLabelText('What happened')
    await fireEvent.update(text, '')

    // The record still carries the old text — the props never change in a
    // unit render — so a strip that reads only the record puts it straight
    // back and the player cannot clear the field to retype.
    expect((text as HTMLTextAreaElement).value).toBe('')
    expect(onSetMatchMoment).not.toHaveBeenCalled()
  })

  // The window is real and narrow: a save's own refetch can land before the
  // draft that triggered it is released. Held in a list BESIDE the record's,
  // the same moment then rendered twice — with duplicate DOM ids, so the
  // clock label pointed at the wrong field.
  it('renders a moment once while its save and the refetch overlap', async () => {
    vi.useFakeTimers()
    try {
      let release = (_: boolean) => {}
      onSetMatchMoment.mockReturnValueOnce(new Promise<boolean>((r) => { release = r }))

      const { rerender } = renderJournal({ record: withMoments(moment('a', '03:23', 'x')) })
      await fireEvent.update(within(row(1, 1)).getByLabelText('What happened'), 'rewritten')
      await vi.advanceTimersByTimeAsync(500)

      // The refetch lands first, carrying the server's copy of the same row.
      await rerender({ record: withMoments(moment('a', '03:23', 'rewritten')) })
      expect(within(strip()).getAllByRole('group', { name: /^Moment/ })).toHaveLength(1)

      release(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(within(strip()).getAllByRole('group', { name: /^Moment/ })).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles a burst of typing into one write', async () => {
    vi.useFakeTimers()
    try {
      renderJournal({ record: withMoments(moment('a', '03:23', 'x')) })
      const text = within(row(1, 1)).getByLabelText('What happened')

      for (const words of ['no', 'no off', 'no off-angle']) {
        await fireEvent.update(text, words)
      }
      expect(onSetMatchMoment).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(500)
      expect(onSetMatchMoment).toHaveBeenCalledTimes(1)
      expect(onSetMatchMoment.mock.calls[0]?.[2]).toMatchObject({ text: 'no off-angle' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not resurrect a moment removed while its save was still settling', async () => {
    vi.useFakeTimers()
    try {
      renderJournal({ record: withMoments(moment('a', '03:23', 'x')) })

      await fireEvent.update(within(row(1, 1)).getByLabelText('What happened'), 'rewritten')
      await fireEvent.click(within(row(1, 1)).getByRole('button', { name: /remove/i }))
      await vi.advanceTimersByTimeAsync(500)

      expect(onDeleteMatchMoment).toHaveBeenCalledWith(KEY, 'a')
      expect(onSetMatchMoment).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
