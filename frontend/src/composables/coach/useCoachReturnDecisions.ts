import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

import type { CoachDecisionEnum, CoachReturnItem, CoachReturnSheet } from '@/api-client'

// The player's verdicts on ONE return sheet, held locally until Finish (or
// "Decide later") writes them back. The server's copy is the seed and the
// destination; nothing here mutates the sheet.
//
// Draft + commit is deliberate: a player flipping Accept/Skip down a list of
// notes should not fire a request per click, and "Decide later" must be able
// to save exactly what was decided so far. `verdicts` is reseeded whenever a
// DIFFERENT sheet arrives (keyed on its id) — that reseed IS the sync
// contract with the server copy.

/** No verdict yet — the note is still pending. */
export type Undecided = ''

export interface ReturnDecisionsApi {
  /** Every verdict, saved and local alike, keyed by note_id. */
  verdicts: Ref<Record<string, CoachDecisionEnum>>
  /** This note's verdict, or '' while undecided. */
  verdictOf: (noteId: string) => CoachDecisionEnum | Undecided
  /** Record one verdict. Accepting an orphan is refused — its match is gone. */
  decide: (note: CoachReturnItem, decision: CoachDecisionEnum) => void
  acceptAll: () => void
  skipAll: () => void
  /** How many notes Finish would write onto matches. */
  acceptedCount: ComputedRef<number>
  /** True when a verdict differs from the server's copy — no PUT otherwise. */
  dirty: ComputedRef<boolean>
  /** The PARTIAL decisions body: every decided note, undecided ones omitted. */
  body: ComputedRef<Record<string, CoachDecisionEnum>>
}

/** A note whose match is not in this history can be skipped but never accepted. */
export function isOrphan(note: CoachReturnItem): boolean {
  return note.status === 'orphan'
}

export function useCoachReturnDecisions(
  sheet: MaybeRefOrGetter<CoachReturnSheet | null>,
): ReturnDecisionsApi {
  const verdicts = ref<Record<string, CoachDecisionEnum>>({})
  let saved: Record<string, CoachDecisionEnum> = {}

  watch(
    () => toValue(sheet)?.id ?? null,
    () => {
      saved = { ...(toValue(sheet)?.decisions ?? {}) }
      verdicts.value = { ...saved }
    },
    // Sync: a sheet swap must not leave one render tick where the previous
    // coach's verdicts are still painted on the new sheet's cards.
    { immediate: true, flush: 'sync' },
  )

  const notes = computed<CoachReturnItem[]>(() => toValue(sheet)?.notes ?? [])

  function verdictOf(noteId: string): CoachDecisionEnum | Undecided {
    return verdicts.value[noteId] ?? ''
  }

  function decide(note: CoachReturnItem, decision: CoachDecisionEnum) {
    if (decision === 'accepted' && isOrphan(note)) return
    verdicts.value = { ...verdicts.value, [note.note_id]: decision }
  }

  function setAll(decision: CoachDecisionEnum) {
    const next = { ...verdicts.value }
    for (const note of notes.value) {
      if (decision === 'accepted' && isOrphan(note)) continue
      next[note.note_id] = decision
    }
    verdicts.value = next
  }

  const acceptedCount = computed(
    () => Object.values(verdicts.value).filter((v) => v === 'accepted').length,
  )

  const body = computed(() => ({ ...verdicts.value }))

  const dirty = computed(() => {
    const current = verdicts.value
    const keys = new Set([...Object.keys(saved), ...Object.keys(current)])
    return [...keys].some((k) => saved[k] !== current[k])
  })

  return {
    verdicts,
    verdictOf,
    decide,
    acceptAll: () => setAll('accepted'),
    skipAll: () => setAll('skipped'),
    acceptedCount,
    dirty,
    body,
  }
}
