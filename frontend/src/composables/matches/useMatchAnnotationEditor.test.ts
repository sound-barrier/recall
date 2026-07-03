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
