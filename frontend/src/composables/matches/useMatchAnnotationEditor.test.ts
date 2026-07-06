import { describe, it, expect } from 'vitest'
import { useMatchAnnotationEditor } from '@/composables/matches/useMatchAnnotationEditor'
import type { MatchRecord } from '@/api-client'

// Partial-dossier fixture cast — same type-boundary pattern as mountWidget.
function rec(): MatchRecord {
  return { match_key: 'match-x', data: {} } as unknown as MatchRecord
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
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
