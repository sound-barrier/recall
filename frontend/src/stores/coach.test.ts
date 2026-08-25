import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { setApiBacking } from '@/api-client'
import { emptyDraft, type CoachNoteDraft } from '@/match/coach/coach-notes'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import { setCoachSessionResume } from '@/queries/coach'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { COACH_SESSION_RESUME_KEY } from '@/composables/shared/storageKeys'

// The session store owns the coach-side loop: what the app is showing (a
// loaned corpus), what the coach has written about it (drafts that
// autosave), and the two lifecycle edges — open and end. The player's
// inbox is `coachReturns.test.ts`.
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
    focus_items: [],
    notes: [],
    handle_from_bundle: true,
    source: 'bundle' as const,
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
    PutCoachFocusItems: vi.fn(async () => undefined),
    ExportCoachNotes: vi.fn(async () => 'recall-coach-notes-sable.zip'),
    ExportCoachSheet: vi.fn(async () => 'recall-review-sable.html'),
    OpenCoachReplaySession: vi.fn(async () => replaySessionView()),
    AddCoachSessionReplayCode: vi.fn(async () => replaySessionView({ match_count: 2 })),
    SetCoachSessionMatchContext: vi.fn(async () => replaySessionView()),
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

// A code-only session: no bundle, no player, one frame per code.
function replaySessionView(over: Record<string, unknown> = {}) {
  return sessionView({
    player: { id: '', handle: '', message: '' },
    exported_at: '',
    match_count: 1,
    handle_from_bundle: false,
    source: 'replay' as const,
    ...over,
  })
}

describe('coach store — opening from replay codes', () => {
  it('opens the same room a bundle does, from six characters', async () => {
    const coach = useCoachStore()
    const app = useAppStore()

    await coach.openFromReplayCodes(['a1b2c3'])
    await settle()

    expect(api.OpenCoachReplaySession).toHaveBeenCalledWith(['a1b2c3'])
    expect(coach.sessionActive).toBe(true)
    expect(coach.sessionSource).toBe('replay')
    // Same destination, same resume arming — it IS a coaching session.
    expect(app.view).toBe('reviews')
    expect(localStorage.getItem(COACH_SESSION_RESUME_KEY)).toBe('true')
  })

  // Nobody has said who this is about, so the room's existing prompt has to
  // fire. handle_from_bundle is what it reads, and a replay session has no
  // bundle to have carried one.
  it('arrives with no player, so the room still asks', async () => {
    const coach = useCoachStore()
    await coach.openFromReplayCodes(['A1B2C3'])
    await settle()
    expect(coach.player?.handle ?? '').toBe('')
    expect(coach.session?.handle_from_bundle).toBe(false)
  })

  it('grows the reel when another code arrives mid-session', async () => {
    const coach = useCoachStore()
    await coach.openFromReplayCodes(['A1B2C3'])
    await settle()

    await coach.addReplayCode('d4e5f6')
    await settle()

    expect(api.AddCoachSessionReplayCode).toHaveBeenCalledWith('d4e5f6')
    expect(coach.session?.match_count).toBe(2)
  })

  // The context rides the SAME save queue the notes use, so the desk shows
  // one Saved line for the frame rather than two that can disagree.
  it('queues the observed context through the note autosave', async () => {
    const coach = useCoachStore()
    await coach.openFromReplayCodes(['A1B2C3'])
    await settle()

    coach.setMatchContext('replay-A1B2C3', { map: 'ilios', hero: 'ana', result: 'defeat' })
    expect(api.SetCoachSessionMatchContext).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    await settle()

    expect(api.SetCoachSessionMatchContext).toHaveBeenCalledWith(
      'replay-A1B2C3', { map: 'ilios', hero: 'ana', result: 'defeat' },
    )
  })

  // A bundle session reports its own door, so the room does not offer the
  // add-a-code affordance where it would 409.
  it('reports the bundle door for a bundle session', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()
    expect(coach.sessionSource).toBe('bundle')
  })
})

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
    // The room lives on the Reviews tab.
    expect(app.view).toBe('reviews')
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
    api.OpenCoachBundle = vi.fn(async () => sessionView({ notes: [RESURFACED], focus_items: [{ item_id: 'f-1', text: 'Ult economy first.' }] }))
    setApiBacking(api)
    const coach = useCoachStore()

    await coach.openBundle()
    await settle()

    expect(coach.notes[MATCH_A]).toEqual({
      kind: 'note', text: 'Late peel on B.', focusTags: ['positioning'], extraTags: [], matchClock: '06:40',
    })
    expect(coach.focusItems).toEqual([{ item_id: 'f-1', text: 'Ult economy first.' }])
  })
})

describe('coach store — the stale-draft leak', () => {
  it("replaces the notes wholesale, so a second player's editor starts empty", async () => {
    api.OpenCoachBundle = vi.fn(async () => sessionView({ notes: [RESURFACED], focus_items: [{ item_id: 'f-1', text: 'Ult economy first.' }] }))
    setApiBacking(api)
    const coach = useCoachStore()

    await coach.openBundle()
    await settle()
    coach.updateNote(MATCH_B, draft({ text: 'Unsaved thought.' }))
    expect(Object.keys(coach.notes)).toHaveLength(2)

    await coach.endSession()
    await settle()

    api.OpenCoachBundle = vi.fn(async () => sessionView({
      player: { id: 'wren-id', handle: 'Wren', message: '' }, notes: [], focus_items: [],
    }))
    setApiBacking(api)
    await coach.openBundle()
    await settle()

    expect(coach.notes).toEqual({})
    expect(coach.focusItems).toEqual([])
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

  it('autosaves the focus list', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateFocusItems([{ item_id: 'f-1', text: 'Ult economy first.' }])
    expect(coach.focusItems).toEqual([{ item_id: 'f-1', text: 'Ult economy first.' }])
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.PutCoachFocusItems).toHaveBeenCalledWith([{ item_id: 'f-1', text: 'Ult economy first.' }])
  })

  // A blank row is the editor's own scaffolding — the row you are about to
  // type into. It stays on screen and never reaches the wire, which the
  // server would refuse anyway.
  it('does not send the blank row the editor is holding open', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateFocusItems([{ item_id: 'f-1', text: 'Ult economy first.' }, { item_id: 'f-2', text: '  ' }])
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.PutCoachFocusItems).toHaveBeenCalledWith([{ item_id: 'f-1', text: 'Ult economy first.' }])
    expect(coach.focusItems).toHaveLength(2)
  })

  // The list rides the same per-key queue as the notes, under a key of its
  // own. Every match key carries a match-/unmatched-/ambiguous- prefix, so
  // none can ever claim that slot — if one could, the item typed into the
  // list would silently replace the note queued beside it.
  it('queues the list beside a note in the same burst, never on top of it', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ text: 'Peel earlier, on B.' }))
    coach.updateFocusItems([{ item_id: 'f-1', text: 'Ult economy first.' }])
    await vi.advanceTimersByTimeAsync(1000)

    expect(api.PutCoachNote).toHaveBeenCalledTimes(1)
    expect(api.PutCoachFocusItems).toHaveBeenCalledTimes(1)
    expect(coach.saveStateFor(MATCH_A)).toBe('saved')
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

  // The page renders the DRAFTS, so it is complete even when a server save
  // failed — saving it is fine. What must NOT happen is the save clearing
  // the End protection: the session's copy is still missing the note, and
  // "End anyway" was the one question standing between that and silence.
  it('saves the page under a failed save, but keeps the End protection', async () => {
    failOn(MATCH_A)
    const coach = useCoachStore()
    const app = useAppStore()
    await coach.openBundle()
    await settle()

    coach.updateNote(MATCH_A, draft({ text: 'On the page, not in the session.' }))
    await vi.advanceTimersByTimeAsync(1000)

    await coach.exportSheet()

    expect(api.ExportCoachSheet).toHaveBeenCalledTimes(1)
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
  // The arming lives here rather than in one button because there are two —
  // the loan slip's and the session sheet's — and which one a coach happened
  // to click used to decide whether unexported work was protected.
  it('asks once more before ending with unexported notes, and can be told no', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()
    coach.updateNote(MATCH_A, draft())

    coach.requestEndSession()
    await settle()

    expect(coach.endArmed).toBe(true)
    expect(api.CloseCoachSession).not.toHaveBeenCalled()

    coach.cancelEndSession()
    expect(coach.endArmed).toBe(false)

    // Asked again, and answered.
    coach.requestEndSession()
    coach.requestEndSession()
    await settle()
    expect(api.CloseCoachSession).toHaveBeenCalledTimes(1)
  })

  // Wails' native save dialog returns "" when the coach cancels it — no
  // error, just no file. Treating that as success is the exact failure the
  // receipt was added to prevent, twice over: it claims an archive that does
  // not exist, and it clears the unexported flag, so End stops asking before
  // the work has been saved anywhere the player can reach.
  it('treats a cancelled save dialog as nothing having happened', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()
    coach.updateNote(MATCH_A, draft())

    // Reassign + re-install: setApiBacking SPREADS, so mutating `api` after
    // the fact reaches nothing. The file's own idiom, and the reason a
    // mockResolvedValueOnce here silently did nothing.
    api.ExportCoachNotes = vi.fn(async () => '')
    setApiBacking(api)
    await coach.exportNotes()
    await settle()

    expect(coach.exportedTo).toBe('')
    expect(coach.dirtySinceExport).toBe(true)
  })

  // The receipt is a claim about the archive on disk, and writing more work
  // makes it false: "Notes saved to …" sitting beside notes that are once
  // again unexported reads as reassurance for work the player will not
  // receive.
  it('withdraws the export receipt once the coach writes more', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()
    coach.updateNote(MATCH_A, draft())
    await coach.exportNotes()
    await settle()
    expect(coach.exportedTo).not.toBe('')

    coach.updateNote(MATCH_A, draft({ text: 'one more thing' }))

    expect(coach.exportedTo).toBe('')
  })

  // The armed button says "End anyway — notes not exported". Exporting makes
  // that sentence false, and the next click would then end immediately on a
  // label describing a state that no longer exists.
  it('disarms once the notes have actually been exported', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()
    coach.updateNote(MATCH_A, draft())

    coach.requestEndSession()
    expect(coach.endArmed).toBe(true)

    await coach.exportNotes()
    await settle()

    expect(coach.endArmed).toBe(false)
  })

  // Arming is a question about the work as it stands. Writing more work is
  // the clearest possible "not yet" — and leaving it armed means a coach who
  // armed, kept working, and came back to End loses the second question
  // entirely, on notes that are once again unexported.
  it('re-arms when the coach keeps working', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()
    coach.updateNote(MATCH_A, draft())

    coach.requestEndSession()
    expect(coach.endArmed).toBe(true)

    coach.updateNote(MATCH_A, draft({ text: 'and one more thing' }))
    expect(coach.endArmed).toBe(false)

    coach.requestEndSession()
    await settle()
    expect(coach.endArmed).toBe(true)
    expect(api.CloseCoachSession).not.toHaveBeenCalled()
  })

  // Nothing is at stake in a clean session, so asking would be ceremony.
  it('ends a clean session without asking', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.requestEndSession()
    await settle()

    expect(coach.endArmed).toBe(false)
    expect(api.CloseCoachSession).toHaveBeenCalledTimes(1)
  })

  // Ending is a landing, not a vanish act: wherever End was pressed from,
  // the session's end is announced (with the notes file's path when one was
  // saved) and the app lands on the Reviews tab the session lived in —
  // goToView re-homes focus on that panel, so nothing is dropped on <body>.
  // (It used to "stay put" in silence: the loan slip disappeared and
  // whichever tab you were on simply showed your own data again.)
  it('gives the app back: server told, flag cleared, refs empty, announced, landed on Reviews', async () => {
    const coach = useCoachStore()
    const app = useAppStore()
    await coach.openBundle()
    await settle()
    coach.updateNote(MATCH_A, draft())
    await app.goToView('matches')

    await coach.endSession()
    await settle()

    expect(api.CloseCoachSession).toHaveBeenCalledTimes(1)
    expect(coach.sessionActive).toBe(false)
    expect(coach.loanedRecords).toEqual([])
    expect(coach.notes).toEqual({})
    expect(localStorage.getItem(COACH_SESSION_RESUME_KEY)).toBeNull()
    expect(app.view).toBe('reviews')
    expect(app.notice).toMatch(/^Session with .+ ended/)
    expect(getQueryClient().getQueryData(qk.coach.session)).toBeNull()
    expect(getQueryClient().getQueryData(qk.coach.matches)).toBeUndefined()
  })

  // The notes and the summary are keyed by PLAYER, not by session: they
  // resurface the next time this bundle is opened. Typing the last sentence
  // and clicking End inside the debounce must not be how it disappears.
  it('flushes the queued note before closing — the coach keeps what they typed', async () => {
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

  it('flushes the list the coach was still typing when End was clicked', async () => {
    const coach = useCoachStore()
    await coach.openBundle()
    await settle()

    coach.updateFocusItems([{ item_id: 'f-1', text: 'Ult economy first.' }])
    await coach.endSession()

    expect(api.PutCoachFocusItems).toHaveBeenCalledWith([{ item_id: 'f-1', text: 'Ult economy first.' }])
  })
})

// Rule 12: the coach's date range, picked map/hero and since-anchor belong
// to THEIR corpus. Applied to the player's they show an arbitrary subset and
// read as a broken export. The matches store owns that state and pushes the
// hooks here — the same inversion the tour flag uses, because the corpus
// flows the other way.
describe('coach store — the coach\'s own narrow', () => {
  it('suspends the narrow when a bundle opens and restores it on End', async () => {
    const coach = useCoachStore()
    const events: string[] = []
    coach.setNarrowSuspender({
      suspend: () => { events.push('suspend'); return true },
      restore: () => { events.push('restore') },
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
      suspend: () => { events.push('suspend'); return true },
      restore: () => { events.push('restore') },
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
      suspend: () => { events.push('suspend'); return true },
      restore: () => { events.push('restore') },
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

    expect(api.SetCoachSessionPlayer).toHaveBeenCalledWith('Wren', 'player')
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

  // Same handle, other KIND: the server re-keys to a different roster row
  // — a team named Aria and a player named Aria are two files of notes —
  // so the drafts must re-hydrate. The identity token carries kind for
  // exactly this: without it, the player's drafts stayed in the editor
  // over the team's session and could be saved into the team's file.
  it("re-hydrates when the same name is confirmed as the other kind", async () => {
    api.OpenCoachReplaySession = vi.fn(async () => sessionView({
      player: { id: '', handle: 'Aria', message: '', kind: 'player' },
      source: 'replay', exported_at: '', notes: [RESURFACED],
    }))
    api.SetCoachSessionPlayer = vi.fn(async (_h: string, kind?: string) => sessionView({
      player: { id: '', handle: 'Aria', message: '', kind: kind ?? 'player' },
      source: 'replay', exported_at: '', notes: [],
    }))
    setApiBacking(api)
    const coach = useCoachStore()
    await coach.openFromReplayCodes(['A1B2C3'])
    await settle()
    expect(coach.notes[MATCH_A]).toBeTruthy()

    await coach.setPlayerHandle('Aria', 'team')
    await settle()

    expect(coach.notes).toEqual({})
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

    expect(api.SetCoachSessionPlayer).toHaveBeenCalledWith('Wren', 'player')
    expect(coach.player?.handle).toBe('Wren')
    expect(coach.notes).toEqual({})
  })

  // Emptying filters a coach deliberately set, without a word, reads as the
  // app having lost them. Saying it unconditionally would be noise for the
  // coach who had none — so suspend() reports whether there was anything to
  // hold, and only then does the room say so.
  it('flags the set-aside only when there was a narrow to set aside', async () => {
    const coach = useCoachStore()
    coach.setNarrowSuspender({ suspend: () => false, restore: () => {} })
    await coach.openBundle()
    await settle()
    expect(coach.narrowSetAside).toBe(false)

    await coach.endSession()
    await settle()

    coach.setNarrowSuspender({ suspend: () => true, restore: () => {} })
    await coach.openBundle()
    await settle()
    expect(coach.narrowSetAside).toBe(true)

    await coach.endSession()
    await settle()
    expect(coach.narrowSetAside).toBe(false)
  })
})
