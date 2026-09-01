import { describe, expect, it, vi } from 'vitest'

import { useReviewDrafts, type DraftWrites, type WireNoteLike } from '@/composables/coach/useReviewDrafts'
import { momentSaveKey } from '@/match/coach/coach-moments'

// The draft rules, driven directly. The queue is a fake that remembers the
// last run per key and runs it on demand — so each rule is a statement
// about WHAT is written and WHEN, not about debounce timing (the autosave
// composable has its own tests for that).

function harness() {
  const writes: { [K in keyof DraftWrites]: ReturnType<typeof vi.fn> } = {
    putNote: vi.fn(async () => undefined),
    deleteNote: vi.fn(async () => undefined),
    putMoment: vi.fn(async () => undefined),
    deleteMoment: vi.fn(async () => undefined),
  }
  const queued = new Map<string, () => Promise<void>>()
  const dirty = vi.fn()
  const drafts = useReviewDrafts({
    writes: writes as unknown as DraftWrites,
    queueSave: (key, run) => { queued.set(key, run) },
    onDirty: dirty,
  })
  const runAll = async () => {
    for (const [key, run] of [...queued]) { queued.delete(key); await run() }
  }
  return { drafts, writes, queued, dirty, runAll }
}

const KEY = 'match-2026-08-01T20-00-00'
const note = (text: string) => ({ kind: 'note' as const, text, focusTags: [], extraTags: [], matchClock: '' })
const moment = (id: string, clock: string, text: string) => ({ momentId: id, matchClock: clock, text, focusTag: '', imageSHA256: '' })

describe('useReviewDrafts', () => {
  it('writes a draft optimistically and PUTs it in wire shape; an emptied draft is a DELETE', async () => {
    const { drafts, writes, runAll, dirty } = harness()
    drafts.updateNote(KEY, note('held the choke'))
    expect(drafts.notes.value[KEY]?.text).toBe('held the choke')
    expect(dirty).toHaveBeenCalledTimes(1)
    await runAll()
    expect(writes.putNote).toHaveBeenCalledWith(KEY, { kind: 'note', text: 'held the choke', focus_tags: [], extra_tags: [], match_clock: '' })

    drafts.updateNote(KEY, note(''))
    await runAll()
    expect(writes.deleteNote).toHaveBeenCalledWith(KEY)
  })

  // The moments hang off the note row and cascade with it — a match with
  // savable moments keeps a reviewed_only note instead of a DELETE.
  it('keeps a reviewed_only note for an emptied draft whose match carries moments', async () => {
    const { drafts, writes, runAll } = harness()
    drafts.updateMoment(KEY, moment('m-1', '04:45', 'peeled late'))
    await runAll()
    drafts.updateNote(KEY, note(''))
    await runAll()
    expect(writes.deleteNote).not.toHaveBeenCalled()
    expect(writes.putNote).toHaveBeenLastCalledWith(KEY, expect.objectContaining({ kind: 'reviewed_only' }))
  })

  it('keeps an unsavable moment local, saves one that says enough under its own key, and opens the note for it', async () => {
    const { drafts, writes, queued, runAll } = harness()
    drafts.updateMoment(KEY, moment('m-1', '', 'no clock yet'))
    expect(drafts.moments.value[KEY]).toHaveLength(1)
    expect(queued.size).toBe(0)

    drafts.updateMoment(KEY, moment('m-1', '04:45', 'peeled late'))
    expect(queued.has(momentSaveKey('m-1'))).toBe(true)
    await runAll()
    // image_sha256 rides every write, empty included: an omitted field reads
    // as "leave it alone", which would make removing a frame impossible.
    expect(writes.putMoment).toHaveBeenCalledWith(KEY, 'm-1', {
      match_clock: '04:45', text: 'peeled late', image_sha256: '',
    })
    expect(drafts.notes.value[KEY]?.kind).toBe('reviewed_only')
  })

  it('deletes only a moment the server has taken; an abandoned draft is just dropped', async () => {
    const { drafts, writes, runAll } = harness()
    drafts.updateMoment(KEY, moment('never-saved', '', 'half'))
    drafts.removeMoment(KEY, 'never-saved')
    await runAll()
    expect(writes.deleteMoment).not.toHaveBeenCalled()

    drafts.updateMoment(KEY, moment('m-1', '04:45', 'x'))
    await runAll()
    drafts.removeMoment(KEY, 'm-1')
    await runAll()
    expect(writes.deleteMoment).toHaveBeenCalledWith(KEY, 'm-1')
    expect(drafts.moments.value[KEY]).toEqual([])
  })

  // Everything hydrated IS saved — a moment removed right after opening
  // still deletes; and a re-hydrate replaces, never merges.
  it('hydrate marks the wire moments as saved and replaces the drafts wholesale; clear empties them', async () => {
    const { drafts, writes, runAll } = harness()
    const wire: WireNoteLike[] = [{
      match_key: KEY, kind: 'note', text: 'from the server', focus_tags: ['mental'],
      moments: [{ moment_id: 'm-s', match_clock: '01:00', text: 'saved earlier' }],
    }]
    drafts.hydrate(wire)
    expect(drafts.notes.value[KEY]?.text).toBe('from the server')
    expect(drafts.moments.value[KEY]?.[0]?.momentId).toBe('m-s')
    drafts.removeMoment(KEY, 'm-s')
    await runAll()
    expect(writes.deleteMoment).toHaveBeenCalledWith(KEY, 'm-s')

    drafts.hydrate([])
    expect(drafts.notes.value).toEqual({})
    drafts.updateNote(KEY, note('x'))
    drafts.clear()
    expect(drafts.notes.value).toEqual({})
    expect(drafts.moments.value).toEqual({})
  })
})
