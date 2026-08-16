import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  CloseCoachSession, DecideCoachReturn, DeleteCoachNote, DeleteMatchCoachNote,
  ExportCoachNotes, GetCoachReturn, OpenCoachBundle, PutCoachNote, PutCoachSummary,
  SetCoachSessionPlayer,
  type CoachDecisionEnum, type CoachNote, type CoachReturnSheet, type CoachSessionView,
} from '@/api-client'
import type { CoachSaveState } from '@/components/coach/coach-room-props'
import { fromWireNote, isEmptyDraft, toNoteInput, type CoachNoteDraft } from '@/match/coach-notes'
import { getQueryClient } from '@/queries/client'
import {
  clearCoachSessionData, setCoachSessionData, setCoachSessionResume, upsertCoachReturn,
  useCoachReturnsQuery, useCoachSessionMatchesQuery, useCoachSessionQuery,
} from '@/queries/coach'
import { qk } from '@/queries/keys'
import { useAppStore } from '@/stores/app'

// The coaching loop, both sides of it.
//
// COACH SIDE — a session is a loan: the player's records live in the query
// cache for as long as it is open and never touch the coach's database. The
// coach's notes DO persist (server-side, keyed by player), so the room's
// drafts are hydrated from the session response and autosaved back.
//
// PLAYER SIDE — the notes come home as a staged return sheet; the player
// accepts or skips each one and the banner nags until none are undecided.
//
// This store must NOT import the matches store: `records` there reads the
// loaned corpus from HERE, and the arrow only points one way.

/** How long a burst of typing settles before the draft is saved. */
const AUTOSAVE_MS = 400

/** Save-queue key for the set-level summary — match keys can't collide with it. */
const SUMMARY_SAVE_KEY = 'summary'

/** Refusal shown when a bundle is opened while the walkthrough is running. */
const TOUR_CONFLICT_REASON
  = 'Finish the walkthrough before opening a player\'s bundle.'

interface QueuedSave {
  timer: ReturnType<typeof setTimeout>
  run:   () => Promise<void>
}

function draftsByMatch(wire: CoachNote[]): Record<string, CoachNoteDraft> {
  return Object.fromEntries(wire.map(note => [note.match_key, fromWireNote(note)]))
}

// "Pending" is derived, never stored: a note is waiting when the player has
// recorded no verdict on it and it CAN be decided (an orphan's match is not
// in this history, so it can never be accepted). Deriving it here — rather
// than trusting the count that came with the sheet — keeps the banner honest
// the moment a decision is written, without a second round-trip.
function undecidedCount(sheet: CoachReturnSheet): number {
  const decisions = sheet.decisions ?? {}
  return (sheet.notes ?? []).filter(n => n.status !== 'orphan' && !decisions[n.note_id]).length
}

function withPending(sheet: CoachReturnSheet): CoachReturnSheet {
  return { ...sheet, pending: undecidedCount(sheet) }
}

export const useCoachStore = defineStore('coach', () => {
  // ── The open session ──────────────────────────────────────────────
  const sessionQuery = useCoachSessionQuery()
  const session = computed(() => sessionQuery.data.value ?? null)
  const sessionActive = computed(() => session.value !== null)
  const player = computed(() => session.value?.player ?? null)
  const coachName = computed(() => session.value?.coach_name ?? '')

  const corpusQuery = useCoachSessionMatchesQuery(sessionActive)
  // Gated on the session as well as the query: a corpus left in the cache
  // for one tick after End must never paint over the coach's own history.
  const loanedRecords = computed(() => (sessionActive.value ? corpusQuery.data.value ?? [] : []))

  // ── The room's editable state ─────────────────────────────────────
  const notes = ref<Record<string, CoachNoteDraft>>({})
  const summary = ref('')
  const selectedKey = ref('')
  const saveState = ref<CoachSaveState>('idle')
  const dirtySinceExport = ref(false)

  const queuedSaves = new Map<string, QueuedSave>()

  async function runSave(run: () => Promise<void>): Promise<void> {
    saveState.value = 'saving'
    try {
      await run()
      saveState.value = 'saved'
    } catch (_) {
      // The reason is on the wire, not actionable here — the room's
      // role=status line is the whole report, and the draft is kept so
      // the coach's words survive a failed save.
      saveState.value = 'error'
    }
  }

  function cancelSave(key: string): void {
    const queued = queuedSaves.get(key)
    if (!queued) return
    clearTimeout(queued.timer)
    queuedSaves.delete(key)
  }

  function cancelSaves(): void {
    for (const key of [...queuedSaves.keys()]) cancelSave(key)
  }

  function queueSave(key: string, run: () => Promise<void>): void {
    cancelSave(key)
    const timer = setTimeout(() => {
      queuedSaves.delete(key)
      void runSave(run)
    }, AUTOSAVE_MS)
    queuedSaves.set(key, { timer, run })
  }

  // Run every queued save NOW — the export has to carry what the coach
  // just typed, not what settled 400 ms ago.
  async function flushSaves(): Promise<void> {
    const runs = [...queuedSaves.values()].map(queued => queued.run)
    cancelSaves()
    await Promise.all(runs.map(runSave))
  }

  // The notes map is REPLACED from the session response, never merged. A
  // draft belongs to the player it was written about, and merging is
  // exactly how one player's words end up in the next player's editor.
  // The token is the session's identity, so the handle PUT echoing the same
  // session leaves the drafts alone while a genuinely different player —
  // or a corrected handle, which re-keys the notes server-side — replaces
  // them.
  let hydratedFor = ''
  function identityOf(view: CoachSessionView | null): string {
    if (!view) return ''
    return [view.player.id, view.player.handle, view.exported_at].join('|')
  }

  watch(session, (view) => {
    const identity = identityOf(view)
    if (identity === hydratedFor) return
    hydratedFor = identity
    cancelSaves()
    notes.value = draftsByMatch(view?.notes ?? [])
    summary.value = view?.summary ?? ''
    selectedKey.value = ''
    saveState.value = 'idle'
    dirtySinceExport.value = false
  }, { immediate: true })

  function selectKey(key: string): void {
    selectedKey.value = key
  }

  // Optimistic by contract: the editor is controlled, and the chips, the
  // Reviewed switch, the reel marks and the sheet tally all render from
  // this one value — so it has to move before the server answers.
  function updateNote(matchKey: string, next: CoachNoteDraft): void {
    notes.value = { ...notes.value, [matchKey]: next }
    dirtySinceExport.value = true
    queueSave(matchKey, async () => {
      // An emptied draft is a DELETE. PUTting an empty note would be a
      // 400 on the kind rules, and would leave a row saying nothing.
      if (isEmptyDraft(next)) await DeleteCoachNote(matchKey)
      else await PutCoachNote(matchKey, toNoteInput(next))
    })
  }

  function updateSummary(text: string): void {
    summary.value = text
    dirtySinceExport.value = true
    queueSave(SUMMARY_SAVE_KEY, async () => { await PutCoachSummary(text) })
  }

  // ── Session lifecycle ─────────────────────────────────────────────

  // Is the onboarding tour up? The matches store owns that flag and pushes
  // it here: the session and the tour are mutually exclusive overlays over
  // the same records seam, and this store must not import that one (the
  // corpus flows the other way).
  const tourOpen = ref(false)
  function setTourOpen(open: boolean): void {
    tourOpen.value = open
  }

  // Pick a bundle, open it, and hand the app to the player. The POST's
  // answer seeds the cache, so nothing GETs the session it just created.
  async function openBundle(): Promise<void> {
    if (tourOpen.value) {
      useAppStore().setError(TOUR_CONFLICT_REASON)
      return
    }
    try {
      const view = await OpenCoachBundle()
      if (!view) return
      setCoachSessionData(view)
      setCoachSessionResume(true)
      await useAppStore().goToView('coach')
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
  }

  // End the loan. Queued autosaves are dropped rather than flushed: the
  // session they belong to is being discarded, and a PUT that lands after
  // the DELETE is a 404 at best.
  async function endSession(): Promise<void> {
    cancelSaves()
    setCoachSessionResume(false)
    try {
      await CloseCoachSession()
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
    // Removes the session AND the corpus nested under it; the hydration
    // watch clears the room's own refs as the session goes null.
    clearCoachSessionData()
    await useAppStore().goToView('matches')
  }

  // A session opened or ended in ANOTHER window on this install. Both
  // windows talk to one backend, so this one has to agree: adopt the flag
  // and re-read the session rather than guessing at its contents. Nothing
  // is navigated — the other window owns the room; this one only needs its
  // writes locked (or unlocked) to match the server that will refuse them.
  async function onSessionChangedElsewhere(active: boolean): Promise<void> {
    if (active === sessionActive.value) return
    setCoachSessionResume(active)
    if (!active) {
      cancelSaves()
      clearCoachSessionData()
      if (useAppStore().view === 'coach') await useAppStore().goToView('matches')
      return
    }
    await sessionQuery.refetch()
  }

  // The bundle suggests a player, the coach confirms one. The echoed view
  // carries THAT player's notes — which is why the room re-hydrates.
  async function setPlayerHandle(handle: string): Promise<void> {
    try {
      setCoachSessionData(await SetCoachSessionPlayer(handle))
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
  }

  async function exportNotes(): Promise<void> {
    await flushSaves()
    try {
      await ExportCoachNotes()
      dirtySinceExport.value = false
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
  }

  // ── The player's inbox ────────────────────────────────────────────
  const returnsQuery = useCoachReturnsQuery()
  const inbox = computed(() => (returnsQuery.data.value ?? []).map(withPending))
  const pendingNoteCount = computed(() => inbox.value.reduce((total, s) => total + s.pending, 0))
  const firstPendingCoach = computed(() => inbox.value.find(s => s.pending > 0)?.coach_name ?? '')

  const returnSheet = ref<CoachReturnSheet | null>(null)

  // The banner the player clicks is rendered FROM the inbox, so the sheet is
  // already in hand — re-reading it would cost a round-trip to be told what we
  // just displayed. The fetch stays for the case the list has not loaded.
  async function openReturnSheet(id: number): Promise<void> {
    const loaded = inbox.value.find(s => s.id === id)
    if (loaded) {
      returnSheet.value = loaded
      return
    }
    try {
      returnSheet.value = withPending(await GetCoachReturn(id))
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
  }

  /** "Decide later" — the sheet closes, the banner keeps nagging. */
  function closeReturnSheet(): void {
    returnSheet.value = null
  }

  /** Open the sheet an import just staged — it came back with the POST. */
  function stageImportedNotes(sheet: CoachReturnSheet): void {
    const staged = withPending(sheet)
    upsertCoachReturn(staged)
    returnSheet.value = staged
  }

  // Merge the verdicts into the cached sheet rather than re-reading it: the
  // decisions we just sent ARE the new state, and the banner has to settle
  // the moment the dialog closes.
  function applyDecisions(id: number, decisions: Record<string, CoachDecisionEnum>): void {
    const sheet = (returnsQuery.data.value ?? []).find(s => s.id === id)
    if (!sheet) return
    upsertCoachReturn({ ...sheet, decisions: { ...(sheet.decisions ?? {}), ...decisions } })
  }

  async function decide(id: number, decisions: Record<string, CoachDecisionEnum>): Promise<void> {
    try {
      await DecideCoachReturn(id, decisions)
      applyDecisions(id, decisions)
      // An accept writes the coach's block onto a match and marks it
      // reviewed-by-coach — the records the dossier renders are stale now.
      await getQueryClient().refetchQueries({ queryKey: qk.matches })
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
  }

  async function removeCoachNote(matchKey: string, id: number): Promise<void> {
    try {
      await DeleteMatchCoachNote(matchKey, id)
      await getQueryClient().refetchQueries({ queryKey: qk.matches })
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
  }

  return {
    session,
    sessionActive,
    player,
    coachName,
    loanedRecords,
    notes,
    summary,
    selectedKey,
    saveState,
    dirtySinceExport,
    selectKey,
    updateNote,
    updateSummary,
    setTourOpen,
    openBundle,
    endSession,
    setPlayerHandle,
    exportNotes,
    inbox,
    pendingNoteCount,
    firstPendingCoach,
    onSessionChangedElsewhere,
    returnSheet,
    openReturnSheet,
    closeReturnSheet,
    stageImportedNotes,
    decide,
    removeCoachNote,
  }
})
