import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/vue'

import MatchJournal from '@/components/matches/detail/MatchJournal.vue'
import type { MatchRecord } from '@/api'
import type { SearchClause } from '@/match/search-query'

type MatchAnnotation = NonNullable<MatchRecord['annotation']>

// MatchJournal writes annotations store-direct through useMatchActions so
// the "saved" pulse is a real persistence receipt. These tests pin the
// JOURNAL's own contract (which cell is rendered, what the keyboard does,
// what gets persisted), so stub the action layer rather than standing up
// Pinia + the api seam.
const onSetMatchAnnotation = vi.fn().mockResolvedValue(true)
vi.mock('@/composables/matches/useMatchActions', () => ({
  useMatchActions: () => ({ onSetMatchAnnotation }),
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
