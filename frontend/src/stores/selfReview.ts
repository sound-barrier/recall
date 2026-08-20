import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  CreateSelfReview, DeleteSelfReview, DeleteSelfReviewMoment, DeleteSelfReviewNote,
  FinishSelfReview, GetSelfReview, PutSelfReviewMoment, PutSelfReviewNote,
  SetSelfReviewFocusItems, SetSelfReviewMatches, UpdateSelfReview,
  type FocusItem,
  type SelfReview,
} from '@/api-client'
import { useCoachAutosave } from '@/composables/coach/useCoachAutosave'
import { useReviewDrafts } from '@/composables/coach/useReviewDrafts'
import { momentSaveKey } from '@/match/coach/coach-moments'
import { savableItems } from '@/match/reviews/focus-items'
import { getQueryClient } from '@/queries/client'
import { invalidateFocus } from '@/queries/focus'
import { qk } from '@/queries/keys'
import { invalidateSelfReviews, upsertSelfReview, useSelfReviewsQuery } from '@/queries/selfReview'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

// The PLAYER's own saved review sittings — sit down with a set of your own
// matches and review them the way a coach would. Not a coaching session:
// nothing is loaned, the profile chip stays up, the narrow is untouched, and
// the write gate never closes (a sitting IS the player's data). The film
// room drives it through the same desk and the same draft rules as a coach's
// session (useReviewDrafts), pointed at the sitting's routes.
//
// One sitting is "open" at a time — the one the room shows. Its notes and
// moments autosave through the per-key queue; the header (the title)
// saves as one PUT under one key. Finish flushes, stamps, and closes the
// room back onto the shelf.

/** The autosave key the sitting's title saves under. */
export const HEADER_SAVE_KEY = 'header'

/**
 * The autosave key the focus list saves under. Separate from the header:
 * they are separate PUTs, so sharing a queue slot would let a title
 * keystroke displace a list edit that had not gone out yet.
 */
export const FOCUS_SAVE_KEY = 'focus-items'

export const useSelfReviewStore = defineStore('selfReview', () => {
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()

  // ── The shelf ──────────────────────────────────────────────────────
  // Fetched once the Reviews tab is on screen (or a sitting is opened from
  // elsewhere), never at boot — nothing nags from this list.
  const openId = ref('')
  const listQuery = useSelfReviewsQuery(() => appStore.view === 'reviews' || openId.value !== '')
  const reviews = computed<SelfReview[]>(() => listQuery.data.value ?? [])

  // ── The open sitting ───────────────────────────────────────────────
  const open = computed(() => reviews.value.find((r) => r.review_id === openId.value) ?? null)
  const roomOpen = computed(() => open.value !== null)
  const title = ref('')
  const focusItems = ref<FocusItem[]>([])
  const selectedKey = ref('')

  // The sitting's matches, in the player's order, from the player's own
  // records — no loan, no second corpus. A member the history no longer
  // holds (hard-deleted since) simply has no frame.
  const records = computed(() => {
    const keys = open.value?.match_keys ?? []
    const byKey = new Map(matchesStore.records.map((r) => [r.match_key, r]))
    return keys.flatMap((k) => { const rec = byKey.get(k); return rec ? [rec] : [] })
  })

  const { saveStateFor, hasFailedSaves, queueSave, cancelSave, flushSaves, discardSaves } = useCoachAutosave()

  /** Why a sitting write was refused or lost, as the banner says it. */
  const UNSAVED_CLOSE_REASON = 'A note in this review could not be saved — it was not kept.'

  // Lifecycle calls are fired from templates and from `void`ed handlers;
  // a rejection there is a console line and a UI that does nothing. Every
  // one reports through the app's banner instead.
  async function reporting<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work()
    } catch (e) {
      appStore.setErrorFromRaw(String(e))
      return undefined
    }
  }

  const drafts = useReviewDrafts({
    writes: {
      putNote:      (matchKey, body) => PutSelfReviewNote(openId.value, matchKey, body),
      deleteNote:   (matchKey) => DeleteSelfReviewNote(openId.value, matchKey),
      putMoment:    (matchKey, momentId, body) => PutSelfReviewMoment(openId.value, matchKey, momentId, body),
      deleteMoment: (matchKey, momentId) => DeleteSelfReviewMoment(openId.value, matchKey, momentId),
    },
    queueSave,
  })
  const { notes, moments, updateNote, updateMoment, removeMoment } = drafts

  function selectKey(key: string): void {
    selectedKey.value = key
  }

  // Hydrate the room from the sitting as the server has it NOW — a GET, not
  // the list's copy: a note removed from the journal while the shelf was not
  // on screen leaves the cached copy stale, and a stale copy rehydrated as a
  // live draft would PUT the removed note straight back. Any queued saves for
  // a previous sitting are settled first, so switching sittings never drops a
  // keystroke — and what could not be settled is reported, then dropped,
  // rather than carried into the next sitting's queue.
  async function openSitting(reviewID: string): Promise<void> {
    await settleQueue()
    const sitting = await GetSelfReview(reviewID)
    upsertSelfReview(sitting)
    openId.value = sitting.review_id
    title.value = sitting.title
    focusItems.value = sitting.focus_items
    selectedKey.value = ''
    drafts.hydrate(Object.values(sitting.notes).map((n) => ({ ...n, moments: n.moments ?? [] })))
  }

  // Flush what is queued against the sitting it was queued for, say so if
  // anything could not land, and empty the queue — a save that outlives its
  // sitting would otherwise run later against whichever sitting is open then
  // (or against none: PUT /self-reviews//notes/…).
  async function settleQueue(): Promise<void> {
    await flushSaves()
    if (hasFailedSaves.value) appStore.setError(UNSAVED_CLOSE_REASON)
    discardSaves()
  }

  /**
   * "Review these": open a sitting over the keys and go to the room. An
   * UNFINISHED sitting already covering the identical set reopens instead —
   * pressing the same button twice must not mint a twin. The list is
   * re-read first because it is lazily fetched (Reviews-tab-gated) and this
   * runs from Matches, where the cache may never have been filled.
   */
  async function createFromKeys(matchKeys: string[]): Promise<void> {
    if (matchKeys.length === 0) return
    await reporting(async () => {
      const existing = await findOpenTwin(matchKeys)
      if (existing !== '') {
        await openSitting(existing)
      } else {
        const created = await CreateSelfReview('', matchKeys)
        upsertSelfReview(created)
        await openSitting(created.review_id)
      }
      await appStore.goToView('reviews')
    })
  }

  async function findOpenTwin(matchKeys: string[]): Promise<string> {
    const fresh = (await listQuery.refetch()).data ?? reviews.value
    const wanted = new Set(matchKeys)
    const twin = fresh.find((r) => !r.finished_at
      && r.match_keys.length === wanted.size
      && r.match_keys.every((k) => wanted.has(k)))
    return twin?.review_id ?? ''
  }

  /** Open a sitting from the shelf. */
  async function openFromShelf(reviewID: string): Promise<void> {
    await reporting(() => openSitting(reviewID))
  }

  function updateTitle(text: string): void {
    title.value = text
    const id = openId.value
    queueSave(HEADER_SAVE_KEY, async () => {
      upsertSelfReview(await UpdateSelfReview(id, title.value))
    })
  }

  // What the sitting concluded. Blank rows are the editor's own scaffolding
  // — the row you are about to type into — so they stay on screen and never
  // reach the wire.
  function updateFocusItems(items: FocusItem[]): void {
    focusItems.value = items
    const id = openId.value
    const saving = savableItems(items)
    queueSave(FOCUS_SAVE_KEY, async () => {
      upsertSelfReview(await SetSelfReviewFocusItems(id, saving))
      // The band on 07 and the session readout both read GET /focus, whose
      // staleTime is Infinity — without this they show the list as it was
      // when first read, so a sitting's conclusions never appear at all.
      await invalidateFocus()
    })
  }

  // The shelf reads the sitting's notes to draw its rail; the room's writes
  // land there once the list is re-read. Cheap and honest: the list goes
  // stale on close and is read once, not once per keystroke.
  async function close(): Promise<void> {
    await reporting(async () => {
      await settleQueue()
      openId.value = ''
      selectedKey.value = ''
      drafts.clear()
      await invalidateSelfReviews()
    })
  }

  /** Finish: settle the queue, stamp the sitting done (and its matches reviewed by self), back to the shelf. */
  async function finish(): Promise<void> {
    await reporting(async () => {
      await flushSaves()
      const done = await FinishSelfReview(openId.value)
      upsertSelfReview(done)
      await close()
      await getQueryClient().refetchQueries({ queryKey: qk.matches })
    })
  }

  /**
   * Take one match out of the OPEN sitting, from the desk. The note and
   * moments on it go with it (the server's rule), so the local drafts are
   * dropped too — a queued save for a removed note would write it back.
   * The last match is refused upstream (the button says so); the guard here
   * is belt and suspenders.
   */
  async function removeMatchFromOpenSitting(matchKey: string): Promise<void> {
    const current = open.value
    if (!current || current.match_keys.length <= 1) return
    await reporting(async () => {
      // Drafts first, THEN the round trip: a debounced save firing during
      // the await would write the note straight back onto a match the
      // sitting no longer holds.
      dropDraft(matchKey)
      if (selectedKey.value === matchKey) selectedKey.value = ''
      const remaining = current.match_keys.filter((k) => k !== matchKey)
      const updated = await SetSelfReviewMatches(current.review_id, remaining)
      upsertSelfReview(updated)
      await getQueryClient().refetchQueries({ queryKey: qk.matches })
    })
  }

  // "Remove from this review" on a match's block — from the journal, outside
  // the room. The room's own drafts (if this sitting is open) follow: the
  // block is gone from the match, so the desk must not keep showing it — and
  // a save still settling for that note is cancelled, or it would write the
  // note straight back.
  async function removeNoteFromSitting(reviewID: string, matchKey: string): Promise<void> {
    await reporting(async () => {
      await DeleteSelfReviewNote(reviewID, matchKey)
      if (reviewID === openId.value) dropDraft(matchKey)
      await invalidateSelfReviews()
      await getQueryClient().refetchQueries({ queryKey: qk.matches })
    })
  }

  function dropDraft(matchKey: string): void {
    cancelSave(matchKey)
    for (const m of moments.value[matchKey] ?? []) cancelSave(momentSaveKey(m.momentId))
    const { [matchKey]: _dropped, ...rest } = notes.value
    notes.value = rest
    const { [matchKey]: _droppedMoments, ...restMoments } = moments.value
    moments.value = restMoments
  }

  /** Delete a sitting from the shelf; its blocks leave every match, the reviewed flags stay. */
  async function remove(reviewID: string): Promise<void> {
    await reporting(async () => {
      if (reviewID === openId.value) await close()
      await DeleteSelfReview(reviewID)
      await invalidateSelfReviews()
      await getQueryClient().refetchQueries({ queryKey: qk.matches })
    })
  }

  return {
    reviews, listQuery, open, openId, roomOpen, records,
    title, focusItems, selectedKey, notes, moments,
    saveStateFor, hasFailedSaves,
    openSitting: openFromShelf, createFromKeys, selectKey,
    updateNote, updateMoment, removeMoment, updateTitle, updateFocusItems,
    close, finish, remove, removeNoteFromSitting, removeMatchFromOpenSitting,
  }
})
