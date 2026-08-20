import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  DecideCoachReturn, DeleteCoachReturn, DeleteMatchCoachNote, GetCoachReturn,
  type CoachDecisionEnum, type CoachReturnSheet,
} from '@/api-client'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { getQueryClient } from '@/queries/client'
import { invalidateFocus } from '@/queries/focus'
import { removeCoachReturn, upsertCoachReturn, useCoachReturnsQuery } from '@/queries/coach'
import { qk } from '@/queries/keys'
import { useAppStore } from '@/stores/app'

// The PLAYER's side of the coaching loop: notes written about their matches
// come home as a staged return sheet, and they accept or skip each one while
// the banner nags until nothing is undecided.
//
// It shares no state with `stores/coach.ts` — that store is the COACH's open
// session (a loan of someone else's records, drafts autosaved back to the
// server), and the two only ever meet at the import affordance, which hands a
// staged sheet across.

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

export const useCoachReturnsStore = defineStore('coachReturns', () => {
  const returnsQuery = useCoachReturnsQuery()
  const inbox = computed(() => (returnsQuery.data.value ?? []).map(withPending))
  const pendingNoteCount = computed(() => inbox.value.reduce((total, s) => total + s.pending, 0))
  const firstPendingCoach = computed(() => inbox.value.find(s => s.pending > 0)?.coach_name ?? '')
  const pendingCoachCount = computed(() =>
    new Set(inbox.value.filter(s => s.pending > 0).map(s => s.coach_name)).size)

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

  /**
   * Open the sheet an import just staged — it came back with the POST.
   *
   * The server has ALREADY landed the archive's focus items (staging is
   * what makes a coach's items live), so the player's list is stale the
   * moment this returns — and the sheet it opens says "these are already
   * on your list", which had better be true.
   */
  function stageImportedNotes(sheet: CoachReturnSheet): void {
    const staged = withPending(sheet)
    upsertCoachReturn(staged)
    returnSheet.value = staged
    void invalidateFocus()
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

  /**
   * Throw a staged sheet away without deciding it. NOT "skip every note":
   * that writes decisions and marks the matches reviewed-by-coach, which is
   * a claim about a review the player has just said they do not want. This
   * drops the file, and the server drops its decisions with it.
   */
  async function discardReturnSheet(id: number): Promise<void> {
    try {
      await DeleteCoachReturn(id)
      removeCoachReturn(id)
      returnSheet.value = null
      // Discarding takes the archive's focus items back off the list — the
      // one way a coach's item ever leaves it, since there is no deny.
      await invalidateFocus()
    } catch (e) {
      useAppStore().setErrorFromRaw(String(e))
    }
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
    inbox,
    pendingNoteCount,
    firstPendingCoach,
    pendingCoachCount,
    returnSheet,
    openReturnSheet,
    closeReturnSheet,
    stageImportedNotes,
    decide,
    discardReturnSheet,
    removeCoachNote,
  }
})
