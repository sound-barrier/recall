import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  CloseCoachSession, DecideCoachReturn, DeleteCoachNote, DeleteMatchCoachNote,
  ExportCoachNotes, GetCoachReturn, OpenCoachBundle, PutCoachNote, PutCoachSummary,
  SetCoachSessionPlayer,
  type CoachDecisionEnum, type CoachNote, type CoachReturnSheet, type CoachSessionView,
} from '@/api-client'
import type { CoachSaveState } from '@/components/coach/coach-room-props'
import { useWriteGate } from '@/composables/shared/useWriteGate'
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

/** Why Export is refused while a note is still unsaved. */
const UNSAVED_EXPORT_REASON
  = 'A note could not be saved, so the archive would be missing it. Try again in a moment.'

/** Reported when the session ends holding a note the server never took. */
const UNSAVED_END_REASON
  = 'The session ended with a note that could not be saved — it was not kept.'

/** Why Export is refused before the coach has a name to sign with. */
const NO_COACH_NAME_REASON = 'Set a coach name in Settings before exporting notes'

/** Why Export is refused before anyone has said who the bundle is about. */
const UNCONFIRMED_EXPORT_REASON = 'Say who this bundle is about before exporting notes'

/**
 * The two halves of "put the coach's own narrow aside for the loan".
 * `stores/matches.ts` owns that filter state and registers these; this
 * store must not import it, so the hooks are pushed in the same way the
 * tour flag is.
 */
export interface CoachNarrowSuspender {
  /** Snapshot the coach's narrow and clear it. */
  suspend: () => void
  /** Put the snapshot back exactly as it was. */
  restore: () => void
}

// One queued autosave. `timer` is null once the run is in flight or has
// failed — a failed run stays in the map so the next flush retries it.
interface PendingSave {
  timer: ReturnType<typeof setTimeout> | null
  run:   () => Promise<void>
}

function draftsByMatch(wire: CoachNote[]): Record<string, CoachNoteDraft> {
  return Object.fromEntries(wire.map(note => [note.match_key, fromWireNote(note)]))
}

// "Pending" is derived from BOTH sides, because each knows something the
// other cannot.
//
// The server's `status` carries facts no client can see: `accepted` means a
// block for that note already sits on the match — true across re-imports and
// fresh installs, where this install recorded no decision of its own — and
// `orphan` means the match is not in this history at all, so the note can
// never be accepted. Deriving from the raw notes instead is what makes a
// repeat session's banner claim seven waiting when five were long accepted.
//
// The local decisions map carries the verdict the player just gave, which
// the server's copy of the sheet won't reflect until it is re-read — so the
// banner settles the moment the dialog closes, with no round-trip.
function undecidedCount(sheet: CoachReturnSheet): number {
  const decisions = sheet.decisions ?? {}
  // Decided is the closed set — accepted, skipped, or an orphan that can
  // never land. Anything else, INCLUDING a status the server did not send,
  // still waits: under-counting hides the banner and the player never
  // learns notes are here, while over-counting is visible and recoverable.
  const settled = new Set(['accepted', 'skipped', 'orphan'])
  return (sheet.notes ?? []).filter(n => !settled.has(n.status ?? '') && !decisions[n.note_id]).length
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
  const dirtySinceExport = ref(false)

  // Save state is PER KEY. One global flag let a successful save on any
  // other match erase the only evidence that this one never landed, and the
  // export then found an empty queue and cleared the "not exported" warning
  // on an archive that was missing the note.
  const saveStates = ref<Record<string, CoachSaveState>>({})
  const pendingSaves = new Map<string, PendingSave>()

  function setSaveState(key: string, state: CoachSaveState): void {
    saveStates.value = { ...saveStates.value, [key]: state }
  }

  /** Where the autosave for one match key — or the session summary — stands. */
  function saveStateFor(key: string): CoachSaveState {
    return saveStates.value[key] ?? 'idle'
  }

  /** True while any draft is still holding words the server never took. */
  const hasFailedSaves = computed(() =>
    Object.values(saveStates.value).some(state => state === 'error'))

  async function failed(run: () => Promise<void>): Promise<boolean> {
    // The reason is on the wire, not actionable here — the room's
    // role=status line is the whole report, and the draft is kept so
    // the coach's words survive a failed save.
    try {
      await run()
      return false
    } catch (_) {
      return true
    }
  }

  // A failed run stays in the map, so the next flush retries it. Dropping it
  // is how a note leaves with an export that never carried it.
  async function runSave(key: string): Promise<void> {
    const queued = pendingSaves.get(key)
    if (!queued) return
    clearQueuedTimer(queued)
    setSaveState(key, 'saving')
    const broke = await failed(queued.run)
    // A newer edit may have claimed the key while this one was in flight;
    // its own run reports for it.
    if (pendingSaves.get(key) !== queued) return
    if (broke) {
      setSaveState(key, 'error')
      return
    }
    pendingSaves.delete(key)
    setSaveState(key, 'saved')
  }

  function clearQueuedTimer(queued: PendingSave): void {
    if (queued.timer !== null) clearTimeout(queued.timer)
    queued.timer = null
  }

  function queueSave(key: string, run: () => Promise<void>): void {
    const previous = pendingSaves.get(key)
    if (previous) clearQueuedTimer(previous)
    pendingSaves.set(key, { timer: setTimeout(() => { void runSave(key) }, AUTOSAVE_MS), run })
  }

  // Run every queued save NOW, retries included — the export has to carry
  // what the coach just typed, not what settled 400 ms ago.
  async function flushSaves(): Promise<void> {
    await Promise.all([...pendingSaves.keys()].map(runSave))
  }

  // Throw the queue away, drafts and failures alike. Only legitimate when
  // the drafts themselves are going — a different player's notes have
  // replaced them.
  function discardSaves(): void {
    for (const queued of pendingSaves.values()) clearQueuedTimer(queued)
    pendingSaves.clear()
    saveStates.value = {}
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
    discardSaves()
    notes.value = draftsByMatch(view?.notes ?? [])
    summary.value = view?.summary ?? ''
    selectedKey.value = ''
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

  // The coach's own narrow, pushed in from the matches store for the same
  // reason (rule 12): her date range and picked map/hero describe HER
  // corpus, and applied to the player's they show an arbitrary subset that
  // reads as a broken export.
  let narrowSuspender: CoachNarrowSuspender | null = null
  let narrowSuspended = false

  function setNarrowSuspender(hooks: CoachNarrowSuspender): void {
    narrowSuspender = hooks
  }

  function suspendCoachNarrow(): void {
    if (narrowSuspended || !narrowSuspender) return
    narrowSuspended = true
    narrowSuspender.suspend()
  }

  function restoreCoachNarrow(): void {
    if (!narrowSuspended || !narrowSuspender) return
    narrowSuspended = false
    narrowSuspender.restore()
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
      suspendCoachNarrow()
      await useAppStore().goToView('coach')
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
  }

  // End the loan. Queued autosaves are FLUSHED first: notes and the summary
  // are keyed by player, not by session — they are re-hydrated the next time
  // this bundle is opened — so a draft caught inside the debounce would
  // otherwise be lost for good.
  async function endSession(): Promise<void> {
    await flushSaves()
    // The loan goes back either way — refusing to end would trap the coach
    // in a session a broken server can never let her leave — but a note the
    // flush could not place is about to be discarded, and that is not
    // something to find out later.
    if (hasFailedSaves.value) useAppStore().setError(UNSAVED_END_REASON)
    setCoachSessionResume(false)
    try {
      await CloseCoachSession()
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
    // Removes the session AND the corpus nested under it; the hydration
    // watch clears the room's own refs as the session goes null.
    clearCoachSessionData()
    restoreCoachNarrow()
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
      discardSaves()
      clearCoachSessionData()
      restoreCoachNarrow()
      if (useAppStore().view === 'coach') await useAppStore().goToView('matches')
      return
    }
    suspendCoachNarrow()
    await sessionQuery.refetch()
  }

  // ── Who this bundle is about ──────────────────────────────────────

  const playerHandle = computed(() => player.value?.handle ?? '')

  /**
   * No confirmed player yet — an anonymous bundle, or one the coach has not
   * accepted the suggestion from. Every note PUT answers 409 until this is
   * false, so the room asks before it lets anyone type.
   */
  const needsPlayerHandle = computed(() => sessionActive.value && playerHandle.value === '')

  // The bundle suggests a player, the coach confirms one. The echoed view
  // carries THAT player's notes — which is why the room re-hydrates.
  async function setPlayerHandle(handle: string): Promise<void> {
    // Naming or correcting the player re-keys the notes server-side, so the
    // hydration watch drops every draft and reloads. Whatever is still in
    // the debounce has to land first — otherwise clicking "Change player"
    // straight after typing discards the sentence, the same way End session
    // used to. A no-op while the session is still unnamed: both writing
    // surfaces are blocked until a handle exists, so nothing is queued.
    await flushSaves()
    try {
      setCoachSessionData(await SetCoachSessionPlayer(handle))
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
  }

  // ── The archive the player receives ───────────────────────────────

  /** Why Export is unavailable, for the affordance's title. '' when it is. */
  const exportBlockedReason = computed(() => {
    if (coachName.value === '') return NO_COACH_NAME_REASON
    if (needsPlayerHandle.value) return UNCONFIRMED_EXPORT_REASON
    if (hasFailedSaves.value) return UNSAVED_EXPORT_REASON
    return ''
  })

  /** False while the archive would be unsigned, unaddressed or incomplete. */
  const canExportNotes = computed(() => exportBlockedReason.value === '')

  // An archive missing a note is worse than a refused export: it also clears
  // `dirtySinceExport`, so the "not exported yet" warning goes with the note.
  // The flush is the retry — only a failure that survives it refuses.
  async function exportNotes(): Promise<void> {
    await flushSaves()
    if (hasFailedSaves.value) {
      useAppStore().setError(UNSAVED_EXPORT_REASON)
      return
    }
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

  /**
   * Write the player's verdicts. REJECTS on failure rather than folding the
   * reason into the error banner: the dialog is what decides whether to
   * close, and a sheet that closes on a write that never landed loses the
   * decisions with it.
   */
  async function decide(id: number, decisions: Record<string, CoachDecisionEnum>): Promise<void> {
    await DecideCoachReturn(id, decisions)
    applyDecisions(id, decisions)
    // An accept writes the coach's block onto a match and marks it
    // reviewed-by-coach — the records the dossier renders are stale now.
    await getQueryClient().refetchQueries({ queryKey: qk.matches })
  }

  /** Take an accepted block back off a match. A write, so it asks the gate. */
  async function removeCoachNote(matchKey: string, id: number): Promise<void> {
    if (!useWriteGate().guardWrite()) return
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
    saveStateFor,
    hasFailedSaves,
    dirtySinceExport,
    canExportNotes,
    exportBlockedReason,
    needsPlayerHandle,
    selectKey,
    updateNote,
    updateSummary,
    setTourOpen,
    setNarrowSuspender,
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
