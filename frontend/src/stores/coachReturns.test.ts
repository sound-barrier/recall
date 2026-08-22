import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { setApiBacking } from '@/api-client'
import type { CoachReturnItem, CoachReturnSheet } from '@/api-client'
import { setCoachSessionResume } from '@/queries/coach'
import { useCoachStore } from '@/stores/coach'
import { useCoachReturnsStore } from '@/stores/coachReturns'

// The player's end of the loop: an archive of someone else's notes about
// the player's own matches, staged for a verdict.
//
// What these tests exist for is the COUNT. It is derived from the notes and
// the decisions on every read — never trusted from the wire — because a
// stale tally either nags about notes long decided or, worse, goes quiet
// while notes are still waiting and the player never learns they arrived.

const MATCH_A = 'match-2026-08-13T22-30-00'

function returnNote(noteId: string, over: Partial<CoachReturnItem> = {}): CoachReturnItem {
  return {
    note_id: noteId,
    match_key: MATCH_A,
    kind: 'note',
    text: 'Late peel on B.',
    focus_tags: [],
    extra_tags: [],
    match_clock: '',
    updated_at: '2026-08-14T19:02:00Z',
    status: 'pending',
    ...over,
  }
}

// Every fixture reports `pending: 0` while carrying undecided notes. That
// mismatch is the point: pending is DERIVED from the notes and the
// decisions, so a stale (or absent) count from the wire can't leave the
// banner lying in either direction.
function sheet(over: Partial<CoachReturnSheet> = {}): CoachReturnSheet {
  return {
    id: 7,
    coach_name: 'Ordo',
    player_handle: 'Sable',
    session_date: '2026-08-14',
    imported_at: '2026-08-15T09:12:00Z',
    focus_items: [],
    notes: [returnNote('n-1'), returnNote('n-2')],
    decisions: {},
    pending: 0,
    player_mismatch: false,
    ...over,
  }
}

function sessionView() {
  return {
    player: { id: 'sable-id', handle: 'Sable', message: 'Ult timing on control?' },
    exported_at: '2026-08-14T18:30:00Z',
    session_date: '2026-08-15',
    match_count: 2,
    coach_name: 'Ordo',
    focus_items: [],
    notes: [],
    handle_from_bundle: true,
    source: 'bundle' as const,
  }
}

let api: Record<string, ReturnType<typeof vi.fn>>

function stubStorage(): void {
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value) },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length },
  })
}

beforeEach(() => {
  stubStorage()
  setActivePinia(createPinia())
  vi.useFakeTimers()
  api = {
    GetVersion: vi.fn(async () => 'dev'),
    GetDataLocation: vi.fn(async () => null),
    CheckForUpdate: vi.fn(async () => null),
    GetProfiles: vi.fn(async () => ({ profiles: ['default'], active: 'default', immutable: [] })),
    OpenCoachBundle: vi.fn(async () => sessionView()),
    GetCoachSession: vi.fn(async () => sessionView()),
    GetCoachSessionMatches: vi.fn(async () => []),
    CloseCoachSession: vi.fn(async () => undefined),
    ListCoachReturns: vi.fn(async () => []),
    GetCoachReturn: vi.fn(async () => sheet()),
    DecideCoachReturn: vi.fn(async () => sheet({ pending: 0, decisions: { 'n-1': 'accepted' } })),
    DeleteMatchCoachNote: vi.fn(async () => undefined),
  }
  setApiBacking(api)
  setCoachSessionResume(false)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Query results land after the notifyManager's scheduling; with fake
// timers a task tick plus a Vue flush is the settle point.
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
  await nextTick()
}

describe('coach returns store — the player-side inbox', () => {
  it('tallies undecided notes across sheets and names the first coach waiting', async () => {
    api.ListCoachReturns = vi.fn(async () => [
      sheet({ id: 1, coach_name: 'Ordo' }),
      sheet({ id: 2, coach_name: 'Vale', notes: [returnNote('n-3')] }),
    ])
    setApiBacking(api)
    const returns = useCoachReturnsStore()
    await settle()

    expect(returns.inbox).toHaveLength(2)
    expect(returns.pendingNoteCount).toBe(3)
    expect(returns.firstPendingCoach).toBe('Ordo')
  })

  it('reports nothing waiting when every note is decided', async () => {
    api.ListCoachReturns = vi.fn(async () => [
      sheet({ decisions: { 'n-1': 'accepted', 'n-2': 'skipped' } }),
    ])
    setApiBacking(api)
    const returns = useCoachReturnsStore()
    await settle()

    expect(returns.pendingNoteCount).toBe(0)
    expect(returns.firstPendingCoach).toBe('')
  })

  // The server derives `accepted` from a block that already sits on the
  // match — a fact the client cannot see. Re-counting those notes is how a
  // repeat session's banner claims seven waiting when five were decided
  // before the archive was even re-imported.
  it('trusts the status the server derived for notes it already accepted', async () => {
    api.ListCoachReturns = vi.fn(async () => [
      sheet({
        notes: [
          returnNote('n-1', { status: 'accepted' }),
          returnNote('n-2', { status: 'skipped' }),
          returnNote('n-3', { status: 'pending' }),
        ],
      }),
    ])
    setApiBacking(api)
    const returns = useCoachReturnsStore()
    await settle()

    expect(returns.pendingNoteCount).toBe(1)
  })

  // A note whose status the server did not send must still nag. Counting
  // only an explicit 'pending' made a missing field mean "decided", which
  // hides the banner entirely — the player never learns notes are waiting.
  // Over-counting is visible and recoverable; under-counting is silent.
  it('counts a note whose status is missing as still waiting', async () => {
    api.ListCoachReturns = vi.fn(async () => [
      sheet({ notes: [{ ...returnNote('n-1'), status: undefined } as unknown as CoachReturnItem] }),
    ])
    setApiBacking(api)
    const returns = useCoachReturnsStore()
    await settle()

    expect(returns.pendingNoteCount).toBe(1)
  })

  // An orphan's match is not in this history, so it can never be accepted
  // — counting it would leave the banner up with nothing to decide.
  it('never counts an orphaned note as waiting', async () => {
    api.ListCoachReturns = vi.fn(async () => [
      sheet({ notes: [returnNote('n-1', { status: 'orphan' }), returnNote('n-2')] }),
    ])
    setApiBacking(api)
    const returns = useCoachReturnsStore()
    await settle()

    expect(returns.pendingNoteCount).toBe(1)
  })

  it('opens a staged sheet on demand and puts it away again', async () => {
    const returns = useCoachReturnsStore()
    await returns.openReturnSheet(7)

    expect(api.GetCoachReturn).toHaveBeenCalledWith(7)
    expect(returns.returnSheet?.id).toBe(7)

    returns.closeReturnSheet()
    expect(returns.returnSheet).toBeNull()
  })

  it('opens the sheet an import just staged without a round-trip', async () => {
    const returns = useCoachReturnsStore()
    await settle()

    // pending: 0 as the import reported it — the count is derived from the
    // notes and their decisions, so the banner still sees two waiting.
    returns.stageImportedNotes(sheet({ id: 9 }))

    expect(returns.returnSheet?.id).toBe(9)
    expect(returns.inbox.map(s => s.id)).toContain(9)
    expect(returns.pendingNoteCount).toBe(2)
    expect(api.GetCoachReturn).not.toHaveBeenCalled()
  })

  it('writes the verdicts as one partial map and settles what the banner counts', async () => {
    api.ListCoachReturns = vi.fn(async () => [sheet()])
    setApiBacking(api)
    const returns = useCoachReturnsStore()
    await settle()
    expect(returns.pendingNoteCount).toBe(2)

    await returns.openReturnSheet(7)
    await returns.decide(7, { 'n-1': 'accepted', 'n-2': 'skipped' })

    expect(api.DecideCoachReturn).toHaveBeenCalledWith(7, { 'n-1': 'accepted', 'n-2': 'skipped' })
    expect(returns.inbox.find(s => s.id === 7)?.pending).toBe(0)
    expect(returns.pendingNoteCount).toBe(0)
  })

  // "Decide later" is the partial arm: the notes left undecided stay
  // pending, so the banner survives the dialog closing.
  it('leaves an undecided note waiting after a partial write', async () => {
    api.ListCoachReturns = vi.fn(async () => [sheet()])
    setApiBacking(api)
    const returns = useCoachReturnsStore()
    await settle()

    await returns.decide(7, { 'n-1': 'accepted' })

    expect(returns.pendingNoteCount).toBe(1)
  })

  it("removes an accepted note from a match and reloads the match's records", async () => {
    const returns = useCoachReturnsStore()
    await returns.removeCoachNote(MATCH_A, 3)

    expect(api.DeleteMatchCoachNote).toHaveBeenCalledWith(MATCH_A, 3)
  })

  // Every writer asks the gate first. A DELETE aimed at the coach's own
  // match while a player's corpus is on loan is exactly the orphan write
  // the session lock exists to refuse.
  it('refuses to remove a note while a coaching session holds the app', async () => {
    const returns = useCoachReturnsStore()
    await useCoachStore().openBundle()
    await settle()

    await returns.removeCoachNote(MATCH_A, 3)

    expect(api.DeleteMatchCoachNote).not.toHaveBeenCalled()
  })

  // The dialog decides whether to close, so the failure has to reach it
  // rather than settling quietly into the error banner.
  it('rejects when the verdicts could not be written', async () => {
    api.ListCoachReturns = vi.fn(async () => [sheet()])
    api.DecideCoachReturn = vi.fn(async () => { throw new Error('500') })
    setApiBacking(api)
    const returns = useCoachReturnsStore()
    await settle()

    await expect(returns.decide(7, { 'n-1': 'accepted' })).rejects.toThrow()
    expect(returns.pendingNoteCount).toBe(2)
  })
})
