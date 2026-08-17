import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { setApiBacking } from '@/api-client'
import type { CoachReturnItem, CoachReturnSheet } from '@/api-client'
import { emptyDraft, type CoachNoteDraft } from '@/match/coach/coach-notes'
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
    GetProfiles: vi.fn(async () => ({ profiles: ['default'], active: 'default', immutable: [] })),
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
    expect(coach.saveStateFor(MATCH_A)).toBe('saved')
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

    expect(coach.saveStateFor(MATCH_A)).toBe('error')
    expect(coach.hasFailedSaves).toBe(true)
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

// A save that failed is the coach's words with nowhere to land. It has to
// stay queued, stay visible on its OWN key, and stand between the archive
// and the player — an export that quietly ships without it is worse than
// the failure, because the "not exported yet" warning goes with it.
describe('coach store — a save that failed', () => {
  function failOn(key: string): void {
    api.PutCoachNote = vi.fn(async (matchKey: string) => {
      if (matchKey === key) throw new Error('409')
      return undefined
    })
    setApiBacking(api)
  }

  it('keeps the failure on its own key when a later save on another lands', async () => {
    failOn(MATCH_A)
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ text: 'The one that failed.' }))
    await vi.advanceTimersByTimeAsync(1000)
    coach.updateNote(MATCH_B, draft({ text: 'The one that landed.' }))
    await vi.advanceTimersByTimeAsync(1000)

    expect(coach.saveStateFor(MATCH_B)).toBe('saved')
    expect(coach.saveStateFor(MATCH_A)).toBe('error')
    expect(coach.hasFailedSaves).toBe(true)
  })

  it('refuses the archive while a save is still failing, and keeps the warning up', async () => {
    failOn(MATCH_A)
    const coach = useCoachStore()
    const app = useAppStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ text: 'Missing from the archive.' }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(coach.canExportNotes).toBe(false)

    await coach.exportNotes()

    // Retried on the way out, still refused, and the player-facing
    // "these notes are not in an archive yet" flag survives.
    expect(api.PutCoachNote).toHaveBeenCalledTimes(2)
    expect(api.ExportCoachNotes).not.toHaveBeenCalled()
    expect(coach.dirtySinceExport).toBe(true)
    expect(app.error).not.toBe('')
  })

  it('exports once the retry lands, and the note is in it', async () => {
    let attempts = 0
    api.PutCoachNote = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('409')
      return undefined
    })
    setApiBacking(api)
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ text: 'Saved on the second try.' }))
    await vi.advanceTimersByTimeAsync(1000)
    await coach.exportNotes()

    expect(coach.hasFailedSaves).toBe(false)
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

  // The notes and the summary are keyed by PLAYER, not by session: they
  // resurface the next time this bundle is opened. Typing the last sentence
  // and clicking End inside the debounce must not be how it disappears.
  it('flushes the queued note before closing — the coach keeps what she typed', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ text: 'The last sentence.' }))
    await coach.endSession()

    expect(api.PutCoachNote).toHaveBeenCalledWith(MATCH_A, expect.objectContaining({
      text: 'The last sentence.',
    }))
  })

  it('says so when the flush could not save everything, rather than closing quietly', async () => {
    api.PutCoachNote = vi.fn(async () => { throw new Error('409') })
    setApiBacking(api)
    const coach = useCoachStore()
    const app = useAppStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ text: 'Never landed.' }))
    await coach.endSession()

    expect(api.CloseCoachSession).toHaveBeenCalledTimes(1)
    expect(app.error).not.toBe('')
  })

  it('flushes the summary the coach was still typing when End was clicked', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateSummary('Ult economy first.')
    await coach.endSession()

    expect(api.PutCoachSummary).toHaveBeenCalledWith('Ult economy first.')
  })
})

// Rule 12: the coach's date range, picked map/hero and since-anchor belong
// to HER corpus. Applied to the player's they show an arbitrary subset and
// read as a broken export. The matches store owns that state and pushes the
// hooks here — the same inversion the tour flag uses, because the corpus
// flows the other way.
describe('coach store — the coach\'s own narrow', () => {
  it('suspends the narrow when a bundle opens and restores it on End', async () => {
    const coach = useCoachStore()
    const events: string[] = []
    coach.setNarrowSuspender({
      suspend: () => events.push('suspend'),
      restore: () => events.push('restore'),
    })

    await coach.openBundle()
    await settle()
    expect(events).toEqual(['suspend'])

    await coach.endSession()
    await settle()
    expect(events).toEqual(['suspend', 'restore'])
  })

  it('restores it when another window ends the session', async () => {
    const coach = useCoachStore()
    const events: string[] = []
    coach.setNarrowSuspender({
      suspend: () => events.push('suspend'),
      restore: () => events.push('restore'),
    })
    await coach.openBundle()
    await settle()

    await coach.onSessionChangedElsewhere(false)
    await settle()

    expect(events).toEqual(['suspend', 'restore'])
  })

  it('leaves the narrow alone when the coach cancels the picker', async () => {
    api.OpenCoachBundle = vi.fn(async () => null)
    setApiBacking(api)
    const coach = useCoachStore()
    const events: string[] = []
    coach.setNarrowSuspender({
      suspend: () => events.push('suspend'),
      restore: () => events.push('restore'),
    })

    await coach.openBundle()

    expect(events).toEqual([])
  })
})

describe('coach store — confirming the player', () => {
  const ANONYMOUS = { player: { id: '', handle: '', message: '' }, handle_from_bundle: false }

  // A bundle that named nobody leaves every note PUT answering 409. The
  // room has to ASK before the coach types, so the store has to say so.
  it('asks who this is when the bundle named nobody', async () => {
    api.OpenCoachBundle = vi.fn(async () => sessionView(ANONYMOUS))
    setApiBacking(api)
    const coach = useCoachStore()

    await coach.openBundle()
    await settle()

    expect(coach.sessionActive).toBe(true)
    expect(coach.needsPlayerHandle).toBe(true)
  })

  it('stops asking once the coach confirms one', async () => {
    api.OpenCoachBundle = vi.fn(async () => sessionView(ANONYMOUS))
    setApiBacking(api)
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    await coach.setPlayerHandle('Wren')
    await settle()

    expect(api.SetCoachSessionPlayer).toHaveBeenCalledWith('Wren')
    expect(coach.player?.handle).toBe('Wren')
    expect(coach.needsPlayerHandle).toBe(false)
  })

  it('never asks when the bundle already named the player', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    expect(coach.needsPlayerHandle).toBe(false)
  })

  // Correcting a handle re-keys the notes server-side, so the store drops
  // its drafts and re-hydrates. Anything still sitting in the 400 ms
  // debounce has to reach the server BEFORE that, or clicking "Change
  // player" right after typing throws the sentence away — the same shape as
  // the End-session bug, on a different button.
  it('flushes what the coach just typed before switching player', async () => {
    api.OpenCoachBundle = vi.fn(async () => sessionView({ notes: [] }))
    setApiBacking(api)
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, { ...emptyDraft(), text: 'Held the ult too long.' })
    await coach.setPlayerHandle('Wren')
    await settle()

    expect(api.PutCoachNote).toHaveBeenCalledWith(MATCH_A, expect.objectContaining({
      text: 'Held the ult too long.',
    }))
  })

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
    const coach = useCoachStore()
    await settle()

    expect(coach.pendingNoteCount).toBe(1)
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
    const coach = useCoachStore()
    await settle()

    expect(coach.pendingNoteCount).toBe(1)
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

  // Every writer asks the gate first. A DELETE aimed at the coach's own
  // match while a player's corpus is on loan is exactly the orphan write
  // the session lock exists to refuse.
  it('refuses to remove a note while a coaching session holds the app', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    await coach.removeCoachNote(MATCH_A, 3)

    expect(api.DeleteMatchCoachNote).not.toHaveBeenCalled()
  })

  // The dialog decides whether to close, so the failure has to reach it
  // rather than settling quietly into the error banner.
  it('rejects when the verdicts could not be written', async () => {
    api.ListCoachReturns = vi.fn(async () => [sheet()])
    api.DecideCoachReturn = vi.fn(async () => { throw new Error('500') })
    setApiBacking(api)
    const coach = useCoachStore()
    await settle()

    await expect(coach.decide(7, { 'n-1': 'accepted' })).rejects.toThrow()
    expect(coach.pendingNoteCount).toBe(2)
  })
})
