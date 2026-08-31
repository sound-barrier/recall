import { afterEach, describe, it, expect, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { useMatchAnnotationEditor } from '@/composables/matches/detail/useMatchAnnotationEditor'
import type { MatchAnnotationInput, MatchRecord } from '@/api-client'

type Annotation = NonNullable<MatchRecord['annotation']>

// Partial-dossier fixture cast — same type-boundary pattern as renderWidget.
function rec(): MatchRecord {
  return { match_key: 'match-x', data: {} } as unknown as MatchRecord
}

function recWith(annotation: Partial<Annotation>): MatchRecord {
  return { match_key: 'match-x', data: {}, annotation } as unknown as MatchRecord
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

// An editor over a fixed record, recording every persisted payload. The
// tags vocabulary is the availableTags arg (the narrowed set's tags).
function editorOver(record: () => MatchRecord, availableTags: string[] = []) {
  const writes: MatchAnnotationInput[] = []
  const editor = useMatchAnnotationEditor(
    record,
    (input) => { writes.push(input); return Promise.resolve(true) },
    () => [],
    () => availableTags,
  )
  return { editor, writes }
}

function key(k: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, cancelable: true })
}

// The "saved ✓" pulse is a persistence receipt, not a keystroke echo — it
// must reflect the actual outcome of the async write, or a failed save
// shows "saved" while the error surfaces (if at all) elsewhere.
describe('commitAnnotation saved pulse', () => {
  it('pulses only after the persist resolves successfully', async () => {
    let resolve!: (ok: boolean) => void
    const editor = useMatchAnnotationEditor(
      rec,
      () => new Promise<boolean>((r) => { resolve = r }),
      () => [],
      () => [],
    )
    editor.commitAnnotation('note')
    expect(editor.savedFlash.value).toBe('') // not before the write lands
    resolve(true)
    await flushMicrotasks()
    expect(editor.savedFlash.value).toBe('note')
  })

  it('does not pulse when the persist reports failure', async () => {
    const editor = useMatchAnnotationEditor(
      rec,
      () => Promise.resolve(false),
      () => [],
      () => [],
    )
    editor.commitAnnotation('note')
    await flushMicrotasks()
    expect(editor.savedFlash.value).toBe('')
  })

  // The reason chooser is a write like any other cell's, so it owes the
  // user the same receipt. It shipped without one because it did not go
  // through commitAnnotation — which is the argument for the pulse living
  // in one place rather than inside that one function.
  it('pulses for the exclusion chooser too', async () => {
    const editor = useMatchAnnotationEditor(rec, () => Promise.resolve(true), () => [], () => [])
    void editor.setExclusionReason('placement')
    await flushMicrotasks()
    expect(editor.savedFlash.value).toBe('exclusion')
  })

  it('does not pulse when the exclusion write fails', async () => {
    const editor = useMatchAnnotationEditor(rec, () => Promise.resolve(false), () => [], () => [])
    void editor.setExclusionReason('placement')
    await flushMicrotasks()
    expect(editor.savedFlash.value).toBe('')
  })

  it('still pulses for a void (fire-and-forget) callback', async () => {
    const editor = useMatchAnnotationEditor(rec, () => undefined, () => [], () => [])
    editor.commitAnnotation('tags')
    await flushMicrotasks()
    expect(editor.savedFlash.value).toBe('tags')
  })
})

// Apply-previous copies members + tags into the DRAFT only: nothing may
// persist until the user confirms (or implicitly confirms by committing
// any field — every commit writes all drafts).
describe('applyAnnotationDraft / confirm / undo', () => {
  function editorWithSpy() {
    const calls: unknown[] = []
    const editor = useMatchAnnotationEditor(
      rec,
      (input) => { calls.push(input); return Promise.resolve(true) },
      () => [],
      () => [],
    )
    return { editor, calls }
  }

  it('apply replaces the draft without emitting a write', () => {
    const { editor, calls } = editorWithSpy()
    editor.memberDraft.value = ['Old']
    editor.applyAnnotationDraft({ members: ['Apollo', 'Zed'], tags: ['Stack'] })
    expect(editor.memberDraft.value).toEqual(['Apollo', 'Zed'])
    expect(editor.tagDraft.value).toEqual(['stack']) // normalized like every tag entry
    expect(editor.applyPending.value).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('confirm persists all drafts and clears the pending state', async () => {
    const { editor, calls } = editorWithSpy()
    editor.applyAnnotationDraft({ members: ['Apollo'], tags: ['stack'] })
    editor.confirmAppliedAnnotation()
    await flushMicrotasks()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ members: ['Apollo'], tags: ['stack'] })
    expect(editor.applyPending.value).toBe(false)
    expect(editor.savedFlash.value).toBe('members')
  })

  it('undo restores the snapshotted draft and never emits', () => {
    const { editor, calls } = editorWithSpy()
    editor.memberDraft.value = ['Old']
    editor.tagDraft.value = ['solo']
    editor.applyAnnotationDraft({ members: ['Apollo'], tags: ['stack'] })
    editor.undoAppliedAnnotation()
    expect(editor.memberDraft.value).toEqual(['Old'])
    expect(editor.tagDraft.value).toEqual(['solo'])
    expect(editor.applyPending.value).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('committing any other field implicitly confirms the applied values', async () => {
    const { editor, calls } = editorWithSpy()
    editor.applyAnnotationDraft({ members: ['Apollo'], tags: ['stack'] })
    editor.noteDraft.value = 'clutch round'
    editor.commitAnnotation('note')
    await flushMicrotasks()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      note: 'clutch round',
      members: ['Apollo'],
      tags: ['stack'],
    })
    expect(editor.applyPending.value).toBe(false)
  })
})

// The drafts are a snapshot of the record's annotation. When the record
// itself is refreshed (a reload after someone else's write, a re-parse),
// the snapshot is stale and must be replaced wholesale.
describe('draft hydration', () => {
  it('hydrates from the record and re-syncs when its annotation changes', async () => {
    const source = ref(recWith({ note: 'first pass', tags: ['stack'] }))
    const { editor } = editorOver(() => source.value)
    expect(editor.noteDraft.value).toBe('first pass')
    expect(editor.tagDraft.value).toEqual(['stack'])

    source.value = recWith({ note: 'second pass', replay_code: 'AB12CD', members: ['Ana'] })
    await nextTick()

    expect(editor.noteDraft.value).toBe('second pass')
    expect(editor.replayDraft.value).toBe('AB12CD')
    expect(editor.memberDraft.value).toEqual(['Ana'])
    expect(editor.tagDraft.value).toEqual([]) // cleared, not left behind
  })

  it('a refreshed record cancels an in-flight apply so undo cannot resurrect it', async () => {
    const source = ref(recWith({ members: ['Ana'] }))
    const { editor } = editorOver(() => source.value)
    editor.applyAnnotationDraft({ members: ['Apollo', 'Zed'], tags: ['stack'] })
    expect(editor.applyPending.value).toBe(true)

    source.value = recWith({ members: ['Kiriko'] })
    await nextTick()
    expect(editor.applyPending.value).toBe(false)

    editor.undoAppliedAnnotation()
    expect(editor.memberDraft.value).toEqual(['Kiriko']) // not the pre-apply snapshot
  })

  it('hasAnyNote ignores whitespace but counts any one populated field', () => {
    const { editor } = editorOver(rec)
    expect(editor.hasAnyNote.value).toBe(false)

    editor.noteDraft.value = '   '
    expect(editor.hasAnyNote.value).toBe(false)

    editor.tagDraft.value = ['stack']
    expect(editor.hasAnyNote.value).toBe(true)
  })
})

describe('member chips', () => {
  it('trims a new member, and a duplicate neither lands nor persists', () => {
    const { editor, writes } = editorOver(rec)
    editor.memberInput.value = '  Ana  '
    editor.addMember()
    expect(editor.memberDraft.value).toEqual(['Ana'])
    expect(editor.memberInput.value).toBe('')
    expect(writes).toHaveLength(1)

    editor.memberInput.value = 'Ana'
    editor.addMember()
    expect(editor.memberDraft.value).toEqual(['Ana'])
    expect(editor.memberInput.value).toBe('') // still consumed
    expect(writes).toHaveLength(1) // no pointless round-trip

    editor.memberInput.value = '   '
    editor.addMember()
    expect(writes).toHaveLength(1)
  })

  it('Enter and comma both commit the chip', () => {
    const { editor } = editorOver(rec)
    editor.memberInput.value = 'Ana'
    const enter = key('Enter')
    editor.onMemberKeydown(enter)
    expect(enter.defaultPrevented).toBe(true)

    editor.memberInput.value = 'Zed'
    editor.onMemberKeydown(key(','))
    expect(editor.memberDraft.value).toEqual(['Ana', 'Zed'])
  })

  it('Backspace pops the last chip only when the input is empty', () => {
    const { editor, writes } = editorOver(rec)
    editor.memberDraft.value = ['Ana', 'Zed']

    editor.memberInput.value = 'Ki'
    editor.onMemberKeydown(key('Backspace'))
    expect(editor.memberDraft.value).toEqual(['Ana', 'Zed']) // the caret is editing text

    editor.memberInput.value = ''
    editor.onMemberKeydown(key('Backspace'))
    expect(editor.memberDraft.value).toEqual(['Ana'])
    expect(writes).toHaveLength(1)

    // An empty chip list has nothing to pop.
    editor.removeMember('Ana')
    editor.onMemberKeydown(key('Backspace'))
    expect(editor.memberDraft.value).toEqual([])
  })
})

describe('tag chips', () => {
  it('lower-cases and trims every entry so the optimistic UI matches the server', () => {
    const { editor, writes } = editorOver(rec)
    editor.tagInput.value = '  Stack  '
    editor.onTagKeydown(key('Enter')) // the free-text adopt path

    expect(editor.tagDraft.value).toEqual(['stack'])
    expect(editor.hasTag('STACK')).toBe(true)
    expect(writes).toHaveLength(1)

    // Re-adding the same tag under a different casing is a no-op.
    editor.tagInput.value = 'STACK'
    editor.onTagKeydown(key('Enter'))
    expect(editor.tagDraft.value).toEqual(['stack'])
    expect(writes).toHaveLength(1)
  })

  it('a named tag toggles on and off, persisting each transition', () => {
    const { editor, writes } = editorOver(rec)
    editor.toggleNamedTag('Stream')
    expect(editor.tagDraft.value).toEqual(['stream'])

    editor.toggleNamedTag('stream')
    expect(editor.tagDraft.value).toEqual([])
    expect(writes).toHaveLength(2)
  })

  it('Backspace on an empty tag input pops the last tag', () => {
    const { editor } = editorOver(rec)
    editor.tagDraft.value = ['stack', 'tilt']
    editor.onTagKeydown(key('Backspace'))
    expect(editor.tagDraft.value).toEqual(['stack'])

    editor.tagInput.value = 'sto'
    editor.onTagKeydown(key('Backspace'))
    expect(editor.tagDraft.value).toEqual(['stack']) // mid-word Backspace edits text
  })
})

describe('tag autocomplete', () => {
  const VOCAB = ['stomp', 'stack', 'solo-q', 'tilt']

  it('offers only unpicked, non-conventional tags matching the typed prefix', () => {
    const { editor } = editorOver(rec, VOCAB)
    editor.tagDraft.value = ['tilt']

    // 'stack' is a quick-add toggle, 'tilt' is already on the match.
    expect(editor.tagSuggestions.value).toEqual(['stomp', 'solo-q'])

    editor.tagInput.value = 'sto'
    expect(editor.tagSuggestions.value).toEqual(['stomp'])

    editor.tagInput.value = 'tom' // prefix match only — no infix
    expect(editor.tagSuggestions.value).toEqual([])
  })

  it('has nothing to offer when the narrowed set carries no tags', () => {
    const { editor } = editorOver(rec, [])
    editor.tagInput.value = 'st'
    expect(editor.tagSuggestions.value).toEqual([])
  })

  it('arrow keys cycle with wrap-around and Enter adopts the highlighted tag', () => {
    const { editor, writes } = editorOver(rec, VOCAB)
    editor.onTagFocus()
    expect(editor.tagSuggestionsOpen.value).toBe(true)

    editor.onTagKeydown(key('ArrowDown'))
    expect(editor.tagCursor.value).toBe(0)
    editor.onTagKeydown(key('ArrowUp'))
    expect(editor.tagCursor.value).toBe(2) // wrapped to the end of ['stomp','solo-q','tilt']

    editor.onTagKeydown(key('Enter'))
    expect(editor.tagDraft.value).toEqual(['tilt'])
    expect(editor.tagCursor.value).toBe(-1)
    expect(editor.tagInput.value).toBe('')
    expect(writes).toHaveLength(1)
  })

  it('Enter with nothing highlighted commits the free-typed text instead', () => {
    const { editor } = editorOver(rec, VOCAB)
    editor.onTagFocus()
    editor.tagInput.value = 'throwing'
    editor.onTagKeydown(key('Enter'))

    expect(editor.tagDraft.value).toEqual(['throwing'])
  })

  it('Escape closes the list without adopting anything', () => {
    const { editor, writes } = editorOver(rec, VOCAB)
    editor.onTagFocus()
    editor.onTagKeydown(key('ArrowDown'))
    editor.onTagKeydown(key('Escape'))

    expect(editor.tagSuggestionsOpen.value).toBe(false)
    expect(editor.tagCursor.value).toBe(-1)
    expect(writes).toHaveLength(0)

    // Closed: the arrow keys stop cycling.
    editor.onTagKeydown(key('ArrowDown'))
    expect(editor.tagCursor.value).toBe(-1)
  })

  it('drops a cursor that the shrinking list no longer reaches', async () => {
    const { editor } = editorOver(rec, VOCAB)
    editor.onTagFocus()
    editor.onTagKeydown(key('ArrowDown'))
    editor.onTagKeydown(key('ArrowDown'))
    expect(editor.tagCursor.value).toBe(1) // 'solo-q'

    editor.tagInput.value = 'sto' // narrows the list to one entry
    await nextTick()
    expect(editor.tagCursor.value).toBe(-1)
  })

  it('Enter on an empty input adds no chip and persists nothing', () => {
    const { editor, writes } = editorOver(rec, VOCAB)
    editor.onTagFocus()
    editor.tagInput.value = '   '
    editor.onTagKeydown(key('Enter'))

    expect(editor.tagDraft.value).toEqual([])
    expect(editor.tagInput.value).toBe('')
    expect(writes).toHaveLength(0)
  })

  it('adopting a suggestion already on the match neither duplicates nor persists', () => {
    const { editor, writes } = editorOver(rec, VOCAB)
    editor.tagDraft.value = ['stomp']
    editor.adoptSuggestion('stomp')

    expect(editor.tagDraft.value).toEqual(['stomp'])
    expect(writes).toHaveLength(0)
  })
})

describe('timers: blur grace period and the saved receipt', () => {
  afterEach(() => { vi.useRealTimers() })

  it('blur commits the typed tag but defers closing so a suggestion click still lands', () => {
    vi.useFakeTimers()
    const { editor } = editorOver(rec, ['stomp'])
    editor.onTagFocus()
    editor.tagInput.value = 'clutch'
    editor.onTagBlur()

    expect(editor.tagDraft.value).toEqual(['clutch'])
    expect(editor.tagSuggestionsOpen.value).toBe(true) // still open for the mousedown

    vi.advanceTimersByTime(120)
    expect(editor.tagSuggestionsOpen.value).toBe(false)
    expect(editor.tagCursor.value).toBe(-1)
  })

  it('a newer save’s pulse survives the older save’s expiry', async () => {
    vi.useFakeTimers()
    const { editor } = editorOver(rec)
    editor.commitAnnotation('note')
    await flushMicrotasks()
    expect(editor.savedFlash.value).toBe('note')

    vi.advanceTimersByTime(600)
    editor.commitAnnotation('tags')
    await flushMicrotasks()
    expect(editor.savedFlash.value).toBe('tags')

    // The note pulse's own timer fires here — it must not clear the tags one.
    vi.advanceTimersByTime(300)
    expect(editor.savedFlash.value).toBe('tags')

    vi.advanceTimersByTime(600)
    expect(editor.savedFlash.value).toBe('')
  })
})

describe('click-to-edit note', () => {
  // The preview renders the note as a flat list of text nodes and <mark>
  // wrappers (the FilterRail hits). A click anywhere in it must land the
  // caret at the same character offset in the textarea behind it.
  const NOTE = 'clutch round two'

  function buildPreview() {
    const container = document.createElement('div')
    container.append('clutch ')
    const mark = document.createElement('mark')
    mark.append('round')
    container.append(mark, ' two')
    document.body.appendChild(container)

    // A stand-in for whichever field is showing. What this composable owes
    // the field is an OFFSET into the text a reader saw; how that becomes a
    // caret is the field's own business, and differs between a textarea and a
    // document editor. Asserting the offset is asserting the contract.
    const focused: (number | undefined)[] = []
    const field = { focus: (at?: number) => focused.push(at) }
    return { container, mark, field, focused }
  }

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('lands the caret at the clicked character offset, past a highlight wrapper', async () => {
    const { container, mark, field, focused } = buildPreview()
    const { editor } = editorOver(() => recWith({ note: NOTE }))
    editor.noteFieldRef.value = field

    // Two characters into the <mark> — 7 ('clutch ') + 2.
    Object.defineProperty(document, 'caretPositionFromPoint', {
      value: () => ({ offsetNode: mark.childNodes[0]!, offset: 2 }),
      configurable: true,
    })
    container.addEventListener('click', editor.enterEditMode)
    container.dispatchEvent(new MouseEvent('click', { clientX: 40, clientY: 12 }))

    expect(editor.isEditingNote.value).toBe(true)
    await nextTick()
    expect(focused).toEqual([9])
  })

  it('falls back to the WebKit-only caret API when the standard one is missing', async () => {
    // macOS dev runs in WKWebView, which only ships caretRangeFromPoint.
    const { container, mark, field, focused } = buildPreview()
    const { editor } = editorOver(() => recWith({ note: NOTE }))
    editor.noteFieldRef.value = field

    Object.defineProperty(document, 'caretPositionFromPoint', { value: undefined, configurable: true })
    Object.defineProperty(document, 'caretRangeFromPoint', {
      value: () => ({ startContainer: mark.childNodes[0]!, startOffset: 5 }),
      configurable: true,
    })
    container.addEventListener('click', editor.enterEditMode)
    container.dispatchEvent(new MouseEvent('click', { clientX: 40, clientY: 12 }))

    await nextTick()
    expect(focused).toEqual([12]) // 'clutch ' + all of 'round'
  })

  it('drops the caret at the end when the editor is opened from the keyboard', async () => {
    const { container, field, focused } = buildPreview()
    const { editor } = editorOver(() => recWith({ note: NOTE }))
    editor.noteFieldRef.value = field

    container.addEventListener('keydown', editor.enterEditMode as (e: Event) => void)
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    await nextTick()
    // No offset at all: a keyboard activation has no point to land on, and
    // the field puts the caret wherever it lands by default.
    expect(focused).toEqual([undefined])
  })

  it('blurring the editor persists the trimmed note and returns to the preview', async () => {
    const { editor, writes } = editorOver(rec)
    editor.isEditingNote.value = true
    editor.noteDraft.value = '  ganked mid  '
    editor.exitNoteEditMode()
    await flushMicrotasks()

    expect(editor.isEditingNote.value).toBe(false)
    expect(writes[0]).toMatchObject({ note: 'ganked mid' })
  })
})

describe('note highlighting', () => {
  it('marks only the terms a note-scoped or bare search clause targets', () => {
    const editor = useMatchAnnotationEditor(
      () => recWith({ note: 'clutch round' }),
      () => true,
      () => [{ field: 'note', value: 'clutch' }, { field: 'tag', value: 'round' }],
      () => [],
    )

    // 'round' belongs to the tag clause — it must not light up in the note.
    // The composable hands out the TERMS now: the note is rendered markdown on
    // both sides, so the read view weaves <mark> through the markup and the
    // editor draws decorations over a document it must not touch. Neither can
    // use a flat list of text runs.
    expect(editor.noteHighlightTerms.value).toEqual(['clutch'])
  })
})
