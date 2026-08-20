import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { setApiBacking, type SelfReview } from '@/api-client'
import { qk } from '@/queries/keys'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import type { FocusItem } from '@/api-client'
import { FOCUS_SAVE_KEY, HEADER_SAVE_KEY, useSelfReviewStore } from '@/stores/selfReview'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The player's own review sitting, driven through the store's public
// actions the way the bulk bar, the room and the shelf drive it. The draft
// rules themselves (DELETE for an emptied note, reviewed_only kept over
// moments, …) are the coach store's and are pinned there; what this pins is
// the sitting's lifecycle: create → open → write → finish → shelf.

const KEY_A = 'match-2026-08-01T20-00-00'
const KEY_B = 'match-2026-08-02T20-00-00'

function sitting(over: Partial<SelfReview> = {}): SelfReview {
  return {
    review_id: 'r-1', title: '', focus_items: [], created_at: '2026-08-18T19:00:00Z', updated_at: '2026-08-18T19:00:00Z',
    match_keys: [KEY_B, KEY_A], notes: {}, ...over,
  }
}

let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  api = {
    GetProfiles: vi.fn(async () => ({ profiles: ['default'], active: 'default', immutable: [] })),
    ListSelfReviews: vi.fn(async () => []),
    CreateSelfReview: vi.fn(async (_title: string, keys: string[]) => sitting({ match_keys: keys })),
    GetSelfReview: vi.fn(async () => sitting()),
    UpdateSelfReview: vi.fn(async (_id: string, title: string) => sitting({ title })),
    SetSelfReviewFocusItems: vi.fn(async (_id: string, items: FocusItem[]) => sitting({ focus_items: items })),
    FinishSelfReview: vi.fn(async () => sitting({ finished_at: '2026-08-18T20:00:00Z' })),
    DeleteSelfReview: vi.fn(async () => undefined),
    SetSelfReviewMatches: vi.fn(async (_id: string, keys: string[]) => sitting({ match_keys: keys })),
    PutSelfReviewNote: vi.fn(async () => undefined),
    DeleteSelfReviewNote: vi.fn(async () => undefined),
    PutSelfReviewMoment: vi.fn(async () => undefined),
    DeleteSelfReviewMoment: vi.fn(async () => undefined),
    GetMatchResults: vi.fn(async () => []),
  }
  setApiBacking(api)
  seedQuery(qk.matches, [
    { match_key: KEY_A, source_files: [], data: { map: 'rialto' } },
    { match_key: KEY_B, source_files: [], data: { map: 'ilios' } },
  ])
})

afterEach(() => { vi.useRealTimers() })

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
  await nextTick()
}

describe('selfReview store — a sitting from the bulk bar', () => {
  it('creates the sitting over the ticked keys, opens the room on Reviews, and orders the records the way the player did', async () => {
    const store = useSelfReviewStore()
    const app = useAppStore()
    useMatchesStore()

    await store.createFromKeys([KEY_B, KEY_A])
    await settle()

    expect(api.CreateSelfReview).toHaveBeenCalledWith('', [KEY_B, KEY_A])
    expect(store.roomOpen).toBe(true)
    expect(app.view).toBe('reviews')
    expect(store.records.map((r) => r.match_key)).toEqual([KEY_B, KEY_A])
  })

  it('autosaves a note, the title, and the focus list under their own keys', async () => {
    const store = useSelfReviewStore()
    await store.createFromKeys([KEY_A])
    await settle()

    store.updateNote(KEY_A, { kind: 'note', text: 'held the choke', focusTags: ['positioning'], extraTags: [], matchClock: '' })
    store.updateTitle("Tuesday's Ana games")
    store.updateFocusItems([{ item_id: 'f-1', text: 'Stop chasing flanks.' }])
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.PutSelfReviewNote).toHaveBeenCalledWith('r-1', KEY_A, {
      kind: 'note', text: 'held the choke', focus_tags: ['positioning'], extra_tags: [], match_clock: '',
    })
    expect(api.UpdateSelfReview).toHaveBeenCalledTimes(1)
    expect(api.UpdateSelfReview).toHaveBeenCalledWith('r-1', "Tuesday's Ana games")
    // Its OWN queue key: sharing the header's would let a title keystroke
    // displace a list edit that had not gone out yet.
    expect(api.SetSelfReviewFocusItems).toHaveBeenCalledWith('r-1', [{ item_id: 'f-1', text: 'Stop chasing flanks.' }])
    expect(store.saveStateFor(HEADER_SAVE_KEY)).toBe('saved')
    expect(store.saveStateFor(FOCUS_SAVE_KEY)).toBe('saved')
  })

  it('Finish flushes what is queued, stamps the sitting, and closes the room', async () => {
    const store = useSelfReviewStore()
    await store.createFromKeys([KEY_A])
    await settle()
    store.updateNote(KEY_A, { kind: 'note', text: 'x', focusTags: [], extraTags: [], matchClock: '' })

    await store.finish()
    await settle()

    // The queued note landed BEFORE the finish — nothing typed is lost.
    expect(api.PutSelfReviewNote).toHaveBeenCalledTimes(1)
    expect(api.FinishSelfReview).toHaveBeenCalledWith('r-1')
    expect(store.roomOpen).toBe(false)
    expect(api.ListSelfReviews).toHaveBeenCalled()
  })

  // Reopening always reads the sitting as the server has it: a note removed
  // from the journal while the shelf was off screen leaves the list's copy
  // stale, and a stale copy rehydrated as a live draft would PUT the removed
  // note straight back.
  it('reopens a sitting from the shelf by reading it fresh, with its notes hydrated, and deletes one', async () => {
    api.ListSelfReviews = vi.fn(async () => [sitting({ title: 'Old' })])
    api.GetSelfReview = vi.fn(async () => sitting({
      title: 'Old', notes: {
        [KEY_A]: { match_key: KEY_A, kind: 'note', text: 'kept', focus_tags: [], extra_tags: [], match_clock: '', created_at: '', updated_at: '' },
      },
    }))
    setApiBacking(api)
    const store = useSelfReviewStore()
    const app = useAppStore()
    await app.goToView('reviews')
    await settle()
    await settle()
    expect(store.reviews).toHaveLength(1)

    await store.openSitting('r-1')
    expect(api.GetSelfReview).toHaveBeenCalledWith('r-1')
    expect(store.roomOpen).toBe(true)
    expect(store.title).toBe('Old')
    expect(store.notes[KEY_A]?.text).toBe('kept')

    await store.remove('r-1')
    expect(api.DeleteSelfReview).toHaveBeenCalledWith('r-1')
    expect(store.roomOpen).toBe(false)
  })

  // Finish must land what is queued BEFORE the completion POST — the server
  // stamps the sitting from what it holds at that moment. Order, not counts.
  it('Finish lands the queued note before the completion POST', async () => {
    const store = useSelfReviewStore()
    await store.createFromKeys([KEY_A])
    await settle()
    store.updateNote(KEY_A, { kind: 'note', text: 'x', focusTags: [], extraTags: [], matchClock: '' })

    await store.finish()
    await settle()

    const putAt = api['PutSelfReviewNote']!.mock.invocationCallOrder[0]!
    const finishAt = api['FinishSelfReview']!.mock.invocationCallOrder[0]!
    expect(putAt).toBeLessThan(finishAt)
  })

  // A save that could not land does not outlive its sitting: close reports
  // it and empties the queue, so opening the next sitting never replays it
  // against the wrong id (or no id at all).
  it('close reports a note that could not be saved and does not carry it into the next sitting', async () => {
    api.PutSelfReviewNote = vi.fn(async () => { throw new Error('HTTP 500: boom') })
    setApiBacking(api)
    const store = useSelfReviewStore()
    const app = useAppStore()
    await store.createFromKeys([KEY_A])
    await settle()
    store.updateNote(KEY_A, { kind: 'note', text: 'lost', focusTags: [], extraTags: [], matchClock: '' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.saveStateFor(KEY_A)).toBe('error')

    await store.close()
    expect(app.error).toMatch(/could not be saved/)
    expect(store.hasFailedSaves).toBe(false)

    api.PutSelfReviewNote = vi.fn(async () => undefined)
    setApiBacking(api)
    await store.createFromKeys([KEY_B])
    await settle()
    expect(api.PutSelfReviewNote).not.toHaveBeenCalled()
  })

  // "Remove from this review" on the open sitting cancels the note's saves
  // still settling — or the flush on close would write it straight back.
  it('removing the open sitting\'s note from the journal cancels its queued save', async () => {
    const store = useSelfReviewStore()
    await store.createFromKeys([KEY_A])
    await settle()
    store.updateNote(KEY_A, { kind: 'note', text: 'typed then removed', focusTags: [], extraTags: [], matchClock: '' })

    await store.removeNoteFromSitting('r-1', KEY_A)
    await store.close()
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.DeleteSelfReviewNote).toHaveBeenCalledWith('r-1', KEY_A)
    expect(api.PutSelfReviewNote).not.toHaveBeenCalled()
    expect(store.notes[KEY_A]).toBeUndefined()
  })

  // Lifecycle calls are fired from templates; a refusal reaches the banner,
  // not the console.
  it('reports a refused create through the app banner', async () => {
    api.CreateSelfReview = vi.fn(async () => { throw new Error('HTTP 409: a coaching session is active') })
    setApiBacking(api)
    const store = useSelfReviewStore()
    const app = useAppStore()
    await store.createFromKeys([KEY_A])
    expect(store.roomOpen).toBe(false)
    expect(app.error).toMatch(/coaching session/)
  })
})

// The desk's take-this-match-out and the bulk bar's twin-dedupe — the two
// store paths the UX pass added.
describe('selfReview store — editing the set and refusing twins', () => {
  it('createFromKeys reopens an identical UNFINISHED sitting instead of minting a twin', async () => {
    const existing = sitting({ review_id: 'r-open', match_keys: [KEY_A, KEY_B] })
    api.ListSelfReviews = vi.fn(async () => [existing])
    api.GetSelfReview = vi.fn(async () => existing)
    setApiBacking(api)
    const store = useSelfReviewStore()

    await store.createFromKeys([KEY_B, KEY_A])
    await settle()

    expect(api.CreateSelfReview).not.toHaveBeenCalled()
    expect(store.openId).toBe('r-open')
  })

  it('createFromKeys does NOT reopen a finished sitting over the same keys', async () => {
    const done = sitting({ review_id: 'r-done', match_keys: [KEY_A], finished_at: '2026-08-18T20:00:00Z' })
    api.ListSelfReviews = vi.fn(async () => [done])
    setApiBacking(api)
    const store = useSelfReviewStore()

    await store.createFromKeys([KEY_A])
    await settle()

    expect(api.CreateSelfReview).toHaveBeenCalledWith('', [KEY_A])
  })

  it('createFromKeys over an empty selection does nothing', async () => {
    const store = useSelfReviewStore()
    await store.createFromKeys([])
    expect(api.CreateSelfReview).not.toHaveBeenCalled()
  })

  it('removeMatchFromOpenSitting drops the draft first, replaces the set, clears the selection', async () => {
    const store = useSelfReviewStore()
    await store.createFromKeys([KEY_B, KEY_A])
    await settle()
    store.selectKey(KEY_B)
    // A note mid-debounce on the match being removed must not resurrect.
    store.updateNote(KEY_B, { kind: 'note', text: 'doomed', focusTags: [], extraTags: [], matchClock: '' })

    await store.removeMatchFromOpenSitting(KEY_B)
    await settle()
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.SetSelfReviewMatches).toHaveBeenCalledWith('r-1', [KEY_A])
    expect(api.PutSelfReviewNote).not.toHaveBeenCalled()
    expect(store.selectedKey).toBe('')
    expect(store.notes[KEY_B]).toBeUndefined()
  })

  it('removeMatchFromOpenSitting refuses the last match', async () => {
    api.CreateSelfReview = vi.fn(async () => sitting({ match_keys: [KEY_A] }))
    api.GetSelfReview = vi.fn(async () => sitting({ match_keys: [KEY_A] }))
    setApiBacking(api)
    const store = useSelfReviewStore()
    await store.createFromKeys([KEY_A])
    await settle()

    await store.removeMatchFromOpenSitting(KEY_A)

    expect(api.SetSelfReviewMatches).not.toHaveBeenCalled()
  })
})
