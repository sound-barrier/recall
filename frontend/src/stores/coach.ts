import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  CloseCoachSession, DeleteCoachMoment, DeleteCoachNote, ExportCoachNotes,
  OpenCoachBundle, PutCoachMoment, PutCoachNote, PutCoachSummary,
  SetCoachSessionPlayer,
  type CoachNote, type CoachSessionView,
} from '@/api-client'
import { useCoachAutosave } from '@/composables/coach/useCoachAutosave'
import { fromWireNote, isEmptyDraft, toNoteInput, type CoachNoteDraft } from '@/match/coach/coach-notes'
import {
  fromWireMoment, isSavable, momentSaveKey, toMomentInput, type CoachMoment,
} from '@/match/coach/coach-moments'
import {
  clearCoachSessionData, setCoachSessionData, setCoachSessionResume,
  useCoachSessionMatchesQuery, useCoachSessionQuery,
} from '@/queries/coach'
import { useAppStore } from '@/stores/app'

// The COACH's side of the coaching loop. A session is a loan: the player's
// records live in the query cache for as long as it is open and never touch
// the coach's database. The coach's notes DO persist (server-side, keyed by
// player), so the room's drafts are hydrated from the session response and
// autosaved back.
//
// The player's side — the notes coming home as a return sheet to accept or
// skip — is `stores/coachReturns.ts`, which shares no state with this one.
//
// This store must NOT import the matches store: `records` there reads the
// loaned corpus from HERE, and the arrow only points one way.

/**
 * Save-queue key for the set-level summary. Every match key carries a
 * `match-` / `unmatched-` / `ambiguous-` prefix (see `@/match/match-key`),
 * so no note can ever queue under this one and displace the summary.
 */
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

function draftsByMatch(wire: CoachNote[]): Record<string, CoachNoteDraft> {
  return Object.fromEntries(wire.map(note => [note.match_key, fromWireNote(note)]))
}

// Moments arrive nested inside their note and are flattened by match key,
// which is what the desk asks for — the note id is the transport's business,
// not the strip's.
function momentsByMatch(wire: CoachNote[]): Record<string, CoachMoment[]> {
  const out: Record<string, CoachMoment[]> = {}
  for (const note of wire) {
    if (note.moments?.length) out[note.match_key] = note.moments.map(fromWireMoment)
  }
  return out
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
  // Per match, because several moments share one — the whole reason they are
  // not just another field on the note.
  const moments = ref<Record<string, CoachMoment[]>>({})
  const summary = ref('')
  const selectedKey = ref('')
  const dirtySinceExport = ref(false)

  // The per-key save queue that debounces a burst of typing into one write
  // and reports where that write stands. Per KEY, not per session: one
  // global flag let a successful save on any other match erase the only
  // evidence that this one never landed, and the export then found an empty
  // queue and cleared the "not exported" warning on an archive that was
  // missing the note.
  const { saveStateFor, hasFailedSaves, queueSave, flushSaves, discardSaves } = useCoachAutosave()

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
    moments.value = momentsByMatch(view?.notes ?? [])
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

  // Optimistic like the note, and for the same reason: the strip, the rail and
  // the reel's mark all render from this value, so it moves before the server
  // answers. Keyed on the MOMENT id rather than the match — several share a
  // match, and a queue keyed on the match would collapse three writes into
  // whichever typed last.
  function updateMoment(matchKey: string, next: CoachMoment): void {
    const bucket = moments.value[matchKey] ?? []
    const at = bucket.findIndex((m) => m.momentId === next.momentId)
    const merged = at < 0 ? [...bucket, next] : bucket.map((m, i) => (i === at ? next : m))
    moments.value = { ...moments.value, [matchKey]: merged }
    dirtySinceExport.value = true
    // A draft that does not yet say enough stays local: PUTting it would be a
    // 400 on the clock rules, and would leave a row pointing at nothing.
    if (!isSavable(next)) return
    queueSave(momentSaveKey(next.momentId), async () => {
      await PutCoachMoment(matchKey, next.momentId, toMomentInput(next))
    })
  }

  function removeMoment(matchKey: string, momentId: string): void {
    const bucket = moments.value[matchKey] ?? []
    const going = bucket.find((m) => m.momentId === momentId)
    moments.value = { ...moments.value, [matchKey]: bucket.filter((m) => m.momentId !== momentId) }
    dirtySinceExport.value = true
    // Never saved means never stored: a draft the coach abandoned has nothing
    // on the server to delete, and asking would 404.
    if (!going || !isSavable(going)) return
    queueSave(momentSaveKey(momentId), async () => {
      await DeleteCoachMoment(matchKey, momentId)
    })
  }

  // The replay code is what makes a timestamped moment actionable: Recall
  // cannot drive the game, so handing over the code to paste into the replay
  // viewer is as far as a link can go. Reads the LOANED corpus rather than the
  // coach's own — useMatchActions has the same routine over the other one.
  async function copyReplayCode(matchKey: string): Promise<void> {
    const code = (loanedRecords.value
      .find((r) => r.match_key === matchKey)?.annotation?.replay_code ?? '').trim()
    if (!code) {
      useAppStore().setError('This match carries no replay code.')
      return
    }
    try {
      await navigator.clipboard.writeText(code)
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
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

  return {
    session,
    sessionActive,
    player,
    coachName,
    loanedRecords,
    notes,
    moments,
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
    updateMoment,
    copyReplayCode,
    removeMoment,
    updateSummary,
    setTourOpen,
    setNarrowSuspender,
    openBundle,
    endSession,
    setPlayerHandle,
    exportNotes,
    onSessionChangedElsewhere,
  }
})
