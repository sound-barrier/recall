import { ref } from 'vue'

import type { CoachMomentWire } from '@/match/coach/coach-moments'
import {
  fromWireMoment, isSavable, momentSaveKey, toMomentInput, type CoachMoment,
} from '@/match/coach/coach-moments'
import {
  fromWireNote, isEmptyDraft, toNoteInput, type CoachNoteDraft, type CoachNoteWire,
} from '@/match/coach/coach-notes'

// The room's editable notes and moments, and the rules for writing them back
// — one mechanism behind two owners. A coach's session and a player's own
// review sitting hold different things on the server (someone else's loaned
// matches vs. your own), but the DESK is one component and the rules of the
// draft are the same:
//
//   - the editor is controlled, so every write is optimistic: chips, the
//     Reviewed switch, the reel marks and the sheet tally all render from
//     the draft before the server answers;
//   - an emptied draft is a DELETE (a PUT of an empty note is refused), UNLESS
//     the match carries moments — the moments hang off the note row and
//     cascade with it, so a match with moments keeps a reviewed_only note;
//   - a moment that does not yet say enough stays local; once it does, it
//     saves under its OWN key (several share a match), and the server opens a
//     reviewed_only note for the first moment on a match — which nothing
//     tells the client, so the draft is opened here too;
//   - only a moment the server has actually taken is deleted from it; a draft
//     the writer abandoned has no row and asking would 404.
//
// Spelled once here rather than in each store: these are exactly the rules
// that were paid for one bug at a time on the coach's side, and a second copy
// is where the next fix would land only once.

/** The four writes a draft owner persists through — the coach's or the sitting's. */
export interface DraftWrites {
  putNote:      (matchKey: string, body: CoachNoteWire) => Promise<unknown>
  deleteNote:   (matchKey: string) => Promise<void>
  putMoment:    (matchKey: string, momentId: string, body: CoachMomentWire) => Promise<unknown>
  deleteMoment: (matchKey: string, momentId: string) => Promise<void>
}

/** A note as the server hands it back — enough of it to hydrate a draft. */
export interface WireNoteLike {
  match_key: string
  kind: CoachNoteWire['kind']
  text?: string
  focus_tags?: string[]
  extra_tags?: string[]
  match_clock?: string
  moments?: { moment_id: string; match_clock: string; text: string; focus_tag?: string }[]
}

export interface ReviewDraftsOptions {
  writes: DraftWrites
  /** The owner's per-key autosave queue. */
  queueSave: (key: string, run: () => Promise<void>) => void
  /** Called on every edit — the owner marks its own "unsaved work" state. */
  onDirty?: () => void
}

/** The note a match keeps when its text is cleared but its moments stand. */
function reviewedOnlyDraft(): CoachNoteDraft {
  return { kind: 'reviewed_only', text: '', focusTags: [], extraTags: [], matchClock: '' }
}

function draftsByMatch(wire: WireNoteLike[]): Record<string, CoachNoteDraft> {
  return Object.fromEntries(wire.map((note) => [note.match_key, fromWireNote(note)]))
}

// Moments arrive nested inside their note and are flattened by match key,
// which is what the desk asks for — the note id is the transport's business,
// not the strip's.
function momentsByMatch(wire: WireNoteLike[]): Record<string, CoachMoment[]> {
  const out: Record<string, CoachMoment[]> = {}
  for (const note of wire) {
    if (note.moments?.length) out[note.match_key] = note.moments.map(fromWireMoment)
  }
  return out
}

export function useReviewDrafts(opts: ReviewDraftsOptions) {
  const notes = ref<Record<string, CoachNoteDraft>>({})
  // Per match, because several moments share one — the whole reason they are
  // not just another field on the note.
  const moments = ref<Record<string, CoachMoment[]>>({})

  // Every moment id the owner has actually written to the server. The
  // moment's CURRENT shape cannot answer "is there something to delete?" — a
  // saved moment whose text was cleared is unsavable and still stored, and
  // asking its shape stranded it on the server forever.
  const savedMomentIds = new Set<string>()

  const dirty = (): void => opts.onDirty?.()

  // Everything hydrated from the server IS saved — that is where it came
  // from — so a moment removed right after opening still deletes.
  function hydrate(wire: WireNoteLike[]): void {
    savedMomentIds.clear()
    for (const note of wire) {
      for (const m of note.moments ?? []) savedMomentIds.add(m.moment_id)
    }
    notes.value = draftsByMatch(wire)
    moments.value = momentsByMatch(wire)
  }

  function clear(): void {
    savedMomentIds.clear()
    notes.value = {}
    moments.value = {}
  }

  function updateNote(matchKey: string, next: CoachNoteDraft): void {
    notes.value = { ...notes.value, [matchKey]: next }
    dirty()
    opts.queueSave(matchKey, async () => {
      if (!isEmptyDraft(next)) {
        await opts.writes.putNote(matchKey, toNoteInput(next))
      } else if ((moments.value[matchKey] ?? []).some(isSavable)) {
        await opts.writes.putNote(matchKey, toNoteInput(reviewedOnlyDraft()))
      } else {
        await opts.writes.deleteNote(matchKey)
      }
    })
  }

  function updateMoment(matchKey: string, next: CoachMoment): void {
    const bucket = moments.value[matchKey] ?? []
    const at = bucket.findIndex((m) => m.momentId === next.momentId)
    const merged = at < 0 ? [...bucket, next] : bucket.map((m, i) => (i === at ? next : m))
    moments.value = { ...moments.value, [matchKey]: merged }
    dirty()
    if (!isSavable(next)) return
    opts.queueSave(momentSaveKey(next.momentId), async () => {
      await opts.writes.putMoment(matchKey, next.momentId, toMomentInput(next))
      savedMomentIds.add(next.momentId)
      notes.value[matchKey] ??= reviewedOnlyDraft()
    })
  }

  function removeMoment(matchKey: string, momentId: string): void {
    const bucket = moments.value[matchKey] ?? []
    moments.value = { ...moments.value, [matchKey]: bucket.filter((m) => m.momentId !== momentId) }
    dirty()
    if (!savedMomentIds.has(momentId)) return
    savedMomentIds.delete(momentId)
    opts.queueSave(momentSaveKey(momentId), async () => {
      await opts.writes.deleteMoment(matchKey, momentId)
    })
  }

  return { notes, moments, hydrate, clear, updateNote, updateMoment, removeMoment }
}
