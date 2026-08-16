import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { setApiBacking } from '@/api-client'
import type { CoachReturnItem, CoachReturnSheet } from '@/api-client'
import { emptyDraft, type CoachNoteDraft } from '@/match/coach-notes'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import { setCoachSessionResume } from '@/queries/coach'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { COACH_SESSION_RESUME_KEY } from '@/composables/shared/storageKeys'

// The session store owns the whole coach-side loop: what the app is
// showing (a loaned corpus), what the coach has written about it (drafts
// that autosave), and the two lifecycle edges — open and end.
//
// The hunt these tests exist for is the stale draft: the notes map is
// hydrated FROM the session response and must be REPLACED wholesale, never
// merged, or the next player's editor opens holding the last player's
// words.

const MATCH_A = 'match-2026-08-13T22-30-00'
const MATCH_B = 'match-2026-08-13T21-14-00'

function sessionView(over: Record<string, unknown> = {}) {
  return {
    player: { id: 'sable-id', handle: 'Sable', message: 'Ult timing on control?' },
    exported_at: '2026-08-14T18:30:00Z',
    session_date: '2026-08-15',
    match_count: 2,
    coach_name: 'Ordo',
    summary: '',
    notes: [],
    handle_from_bundle: true,
    ...over,
  }
}

const RESURFACED = {
  note_id: 'n-1',
  match_key: MATCH_A,
  kind: 'note' as const,
  text: 'Late peel on B.',
  focus_tags: ['positioning'],
  extra_tags: [],
  match_clock: '06:40',
  updated_at: '2026-08-14T19:02:00Z',
}

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
    summary: '',
    notes: [returnNote('n-1'), returnNote('n-2')],
    decisions: {},
    pending: 0,
    player_mismatch: false,
    ...over,
  }
}

function draft(over: Partial<CoachNoteDraft> = {}): CoachNoteDraft {
  return { ...emptyDraft(), text: 'Peel earlier.', ...over }
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
    OpenCoachBundle: vi.fn(async () => sessionView()),
    GetCoachSession: vi.fn(async () => sessionView()),
    GetCoachSessionMatches: vi.fn(async () => [
      { match_key: MATCH_A, source_files: [], data: {} },
      { match_key: MATCH_B, source_files: [], data: {} },
    ]),
    CloseCoachSession: vi.fn(async () => undefined),
    SetCoachSessionPlayer: vi.fn(async () => sessionView({ player: { id: '', handle: 'Wren', message: '' } })),
    PutCoachNote: vi.fn(async () => undefined),
    DeleteCoachNote: vi.fn(async () => undefined),
    PutCoachSummary: vi.fn(async () => undefined),
    ExportCoachNotes: vi.fn(async () => 'recall-coach-notes-sable.zip'),
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

describe('coach store — opening a bundle', () => {
  it('loans the app to the player: session, records, room', async () => {
    const coach = useCoachStore()
    const app = useAppStore()
    expect(coach.sessionActive).toBe(false)
    expect(coach.loanedRecords).toEqual([])

    await coach.openBundle()
    await settle()

    expect(coach.sessionActive).toBe(true)
    expect(coach.player?.handle).toBe('Sable')
    expect(coach.coachName).toBe('Ordo')
    expect(coach.loanedRecords.map(r => r.match_key)).toEqual([MATCH_A, MATCH_B])
    expect(app.view).toBe('coach')
    // Seeded from the POST — resuming never costs a second GET.
    expect(api.GetCoachSession).not.toHaveBeenCalled()
  })

  it('arms the resume flag so a reload asks for the session', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    expect(localStorage.getItem(COACH_SESSION_RESUME_KEY)).toBe('true')
  })

  it('does nothing at all when the coach cancels the picker', async () => {
    api.OpenCoachBundle = vi.fn(async () => null)
    setApiBacking(api)
    const coach = useCoachStore()
    const app = useAppStore()

    await coach.openBundle()

    expect(coach.sessionActive).toBe(false)
    expect(app.view).toBe('matches')
    expect(localStorage.getItem(COACH_SESSION_RESUME_KEY)).toBeNull()
  })

  // The session and the tour are mutually exclusive overlays over the same
  // records seam. The matches store owns the tour flag and pushes it here,
  // because the arrow between the two stores only points one way.
  it('refuses to open a bundle while the onboarding tour is running', async () => {
    const coach = useCoachStore()
    const app = useAppStore()
    coach.setTourOpen(true)

    await coach.openBundle()

    expect(api.OpenCoachBundle).not.toHaveBeenCalled()
    expect(coach.sessionActive).toBe(false)
    expect(app.error).not.toBe('')
  })

  it('hydrates the notes the coach wrote about this player in an earlier session', async () => {
    api.OpenCoachBundle = vi.fn(async () => sessionView({ notes: [RESURFACED], summary: 'Ult economy first.' }))
    setApiBacking(api)
    const coach = useCoachStore()

    await coach.openBundle()
    await settle()

    expect(coach.notes[MATCH_A]).toEqual({
      kind: 'note', text: 'Late peel on B.', focusTags: ['positioning'], extraTags: [], matchClock: '06:40',
    })
    expect(coach.summary).toBe('Ult economy first.')
  })
})

describe('coach store — the stale-draft leak', () => {
  it("replaces the notes wholesale, so a second player's editor starts empty", async () => {
    api.OpenCoachBundle = vi.fn(async () => sessionView({ notes: [RESURFACED], summary: 'Ult economy first.' }))
    setApiBacking(api)
    const coach = useCoachStore()

    await coach.openBundle()
    await settle()
    coach.updateNote(MATCH_B, draft({ text: 'Unsaved thought.' }))
    expect(Object.keys(coach.notes)).toHaveLength(2)

    await coach.endSession()
    await settle()

    api.OpenCoachBundle = vi.fn(async () => sessionView({
      player: { id: 'wren-id', handle: 'Wren', message: '' }, notes: [], summary: '',
    }))
    setApiBacking(api)
    await coach.openBundle()
    await settle()

    expect(coach.notes).toEqual({})
    expect(coach.summary).toBe('')
    expect(coach.selectedKey).toBe('')
  })
})

describe('coach store — autosave', () => {
  it('shows the draft immediately and PUTs it once the typing settles', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ focusTags: ['positioning'], matchClock: '04:12' }))
    expect(coach.notes[MATCH_A]?.text).toBe('Peel earlier.')
    expect(api.PutCoachNote).not.toHaveBeenCalled()

    coach.updateNote(MATCH_A, draft({ text: 'Peel earlier, on B.', focusTags: ['positioning'], matchClock: '04:12' }))
    await vi.advanceTimersByTimeAsync(1000)

    // One PUT for the burst, carrying the LAST draft in wire shape.
    expect(api.PutCoachNote).toHaveBeenCalledTimes(1)
    expect(api.PutCoachNote).toHaveBeenCalledWith(MATCH_A, {
      kind: 'note',
      text: 'Peel earlier, on B.',
      focus_tags: ['positioning'],
      extra_tags: [],
      match_clock: '04:12',
    })
    expect(coach.saveState).toBe('saved')
  })

  it('sends a DELETE for an emptied draft rather than a PUT of an empty note', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft())
    await vi.advanceTimersByTimeAsync(1000)
    coach.updateNote(MATCH_A, emptyDraft())
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.DeleteCoachNote).toHaveBeenCalledWith(MATCH_A)
    expect(api.PutCoachNote).toHaveBeenCalledTimes(1)
  })

  it('debounces each match separately', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ text: 'A' }))
    coach.updateNote(MATCH_B, draft({ text: 'B' }))
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.PutCoachNote).toHaveBeenCalledTimes(2)
  })

  it('reports a failed save rather than pretending it landed', async () => {
    api.PutCoachNote = vi.fn(async () => { throw new Error('409') })
    setApiBacking(api)
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft())
    await vi.advanceTimersByTimeAsync(1000)

    expect(coach.saveState).toBe('error')
  })

  it('autosaves the session summary', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateSummary('Ult economy first.')
    expect(coach.summary).toBe('Ult economy first.')
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.PutCoachSummary).toHaveBeenCalledWith('Ult economy first.')
  })

  it('flushes queued autosaves before exporting, so the archive is current', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ text: 'In the archive.' }))
    await coach.exportNotes()

    expect(api.PutCoachNote).toHaveBeenCalledTimes(1)
    expect(api.ExportCoachNotes).toHaveBeenCalledTimes(1)
    expect(coach.dirtySinceExport).toBe(false)
  })
})

describe('coach store — ending the session', () => {
  it('gives the app back: server told, flag cleared, refs empty, Matches again', async () => {
    const coach = useCoachStore()
    const app = useAppStore()
    await coach.openBundle()
    await settle()
    coach.updateNote(MATCH_A, draft())

    await coach.endSession()
    await settle()

    expect(api.CloseCoachSession).toHaveBeenCalledTimes(1)
    expect(coach.sessionActive).toBe(false)
    expect(coach.loanedRecords).toEqual([])
    expect(coach.notes).toEqual({})
    expect(localStorage.getItem(COACH_SESSION_RESUME_KEY)).toBeNull()
    expect(app.view).toBe('matches')
    expect(getQueryClient().getQueryData(qk.coach.session)).toBeNull()
    expect(getQueryClient().getQueryData(qk.coach.matches)).toBeUndefined()
  })

  it('drops queued autosaves — the session is over, the note has nowhere to land', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft())
    await coach.endSession()
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.PutCoachNote).not.toHaveBeenCalled()
  })
})

describe('coach store — confirming the player', () => {
  it("re-hydrates from the corrected player's own notes", async () => {
    api.OpenCoachBundle = vi.fn(async () => sessionView({
      player: { id: '', handle: 'unknown', message: '' }, notes: [RESURFACED],
    }))
    setApiBacking(api)
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()
    expect(coach.notes[MATCH_A]).toBeTruthy()

    await coach.setPlayerHandle('Wren')
    await settle()

    expect(api.SetCoachSessionPlayer).toHaveBeenCalledWith('Wren')
    expect(coach.player?.handle).toBe('Wren')
    expect(coach.notes).toEqual({})
  })
})

describe('coach store — the player-side inbox', () => {
  it('tallies undecided notes across sheets and names the first coach waiting', async () => {
    api.ListCoachReturns = vi.fn(async () => [
      sheet({ id: 1, coach_name: 'Ordo' }),
      sheet({ id: 2, coach_name: 'Vale', notes: [returnNote('n-3')] }),
    ])
    setApiBacking(api)
    const coach = useCoachStore()
    await settle()

    expect(coach.inbox).toHaveLength(2)
    expect(coach.pendingNoteCount).toBe(3)
    expect(coach.firstPendingCoach).toBe('Ordo')
  })

  it('reports nothing waiting when every note is decided', async () => {
    api.ListCoachReturns = vi.fn(async () => [
      sheet({ decisions: { 'n-1': 'accepted', 'n-2': 'skipped' } }),
    ])
    setApiBacking(api)
    const coach = useCoachStore()
    await settle()

    expect(coach.pendingNoteCount).toBe(0)
    expect(coach.firstPendingCoach).toBe('')
  })

  // An orphan's match is not in this history, so it can never be accepted
  // — counting it would leave the banner up with nothing to decide.
  it('never counts an orphaned note as waiting', async () => {
    api.ListCoachReturns = vi.fn(async () => [
      sheet({ notes: [returnNote('n-1', { status: 'orphan' }), returnNote('n-2')] }),
    ])
    setApiBacking(api)
    const coach = useCoachStore()
    await settle()

    expect(coach.pendingNoteCount).toBe(1)
  })

  it('opens a staged sheet on demand and puts it away again', async () => {
    const coach = useCoachStore()
    await coach.openReturnSheet(7)

    expect(api.GetCoachReturn).toHaveBeenCalledWith(7)
    expect(coach.returnSheet?.id).toBe(7)

    coach.closeReturnSheet()
    expect(coach.returnSheet).toBeNull()
  })

  it('opens the sheet an import just staged without a round-trip', async () => {
    const coach = useCoachStore()
    await settle()

    // pending: 0 as the import reported it — the count is derived from the
    // notes and their decisions, so the banner still sees two waiting.
    coach.stageImportedNotes(sheet({ id: 9 }))

    expect(coach.returnSheet?.id).toBe(9)
    expect(coach.inbox.map(s => s.id)).toContain(9)
    expect(coach.pendingNoteCount).toBe(2)
    expect(api.GetCoachReturn).not.toHaveBeenCalled()
  })

  it('writes the verdicts as one partial map and settles what the banner counts', async () => {
    api.ListCoachReturns = vi.fn(async () => [sheet()])
    setApiBacking(api)
    const coach = useCoachStore()
    await settle()
    expect(coach.pendingNoteCount).toBe(2)

    await coach.openReturnSheet(7)
    await coach.decide(7, { 'n-1': 'accepted', 'n-2': 'skipped' })

    expect(api.DecideCoachReturn).toHaveBeenCalledWith(7, { 'n-1': 'accepted', 'n-2': 'skipped' })
    expect(coach.inbox.find(s => s.id === 7)?.pending).toBe(0)
    expect(coach.pendingNoteCount).toBe(0)
  })

  // "Decide later" is the partial arm: the notes left undecided stay
  // pending, so the banner survives the dialog closing.
  it('leaves an undecided note waiting after a partial write', async () => {
    api.ListCoachReturns = vi.fn(async () => [sheet()])
    setApiBacking(api)
    const coach = useCoachStore()
    await settle()

    await coach.decide(7, { 'n-1': 'accepted' })

    expect(coach.pendingNoteCount).toBe(1)
  })

  it("removes an accepted note from a match and reloads the match's records", async () => {
    const coach = useCoachStore()
    await coach.removeCoachNote(MATCH_A, 3)

    expect(api.DeleteMatchCoachNote).toHaveBeenCalledWith(MATCH_A, 3)
  })
})
