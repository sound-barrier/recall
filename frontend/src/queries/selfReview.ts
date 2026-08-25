import { useQuery } from '@tanstack/vue-query'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

import { ListCoachPlayerNotes, ListCoachPlayers, ListSelfReviews, ListShareExports, type SelfReview } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// The player's own review sittings, as the shelf and the room read them.
// Gated on the caller's say-so (the Reviews tab being on screen, or a sitting
// being opened) rather than fetched at boot: the list is only ever looked at
// on that tab, and nothing nags from it the way the coach inbox does.
export function useSelfReviewsQuery(enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: qk.selfReviews,
    queryFn: ListSelfReviews,
    enabled: () => toValue(enabled),
  }, getQueryClient())
}

// The sent ledger — same gate as the shelf: read when the Reviews tab is on
// screen, never at boot.
export function useShareExportsQuery(enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: qk.shares,
    queryFn: ListShareExports,
    enabled: () => toValue(enabled),
  }, getQueryClient())
}

// The coach's roster — 03's list, same tab gate.
export function useCoachPlayersQuery(enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: qk.coachPlayers,
    queryFn: ListCoachPlayers,
    enabled: () => toValue(enabled),
  }, getQueryClient())
}

// One coached identity's whole file of notes — fetched when their dossier
// asks for it, cached per identity like any other server state.
export function useCoachPlayerNotesQuery(id: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: computed(() => qk.coachPlayerNotes(toValue(id))),
    queryFn: () => ListCoachPlayerNotes(toValue(id)),
    enabled: () => toValue(enabled),
  }, getQueryClient())
}

// The roster and every dossier file go stale together: a session writes
// notes, may mint a new identity, and ends — after which "Read every
// note" showing the pre-session file would betray the one surface whose
// whole point is continuity.
export async function invalidateCoachRoster(): Promise<void> {
  const qc = getQueryClient()
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.coachPlayers }),
    qc.invalidateQueries({ queryKey: qk.coachPlayerNotesAll }),
  ])
}

// Mark the shelf stale after a write that changes what it lists. Invalidate,
// not refetch: the list is gated on the Reviews tab being on screen, and a
// refetch of a DISABLED query is silently skipped — a note removed from the
// journal on the Matches tab left the shelf (and the sitting reopened from
// it) showing the note. An invalidation is honored the moment the query is
// enabled again, and fetches at once when it already is.
export function invalidateSelfReviews(): Promise<unknown> {
  return getQueryClient().invalidateQueries({ queryKey: qk.selfReviews })
}

/** Put one sitting into the cached list — the room's writes keep the shelf honest without a round trip. */
export function upsertSelfReview(sitting: SelfReview): void {
  getQueryClient().setQueryData<SelfReview[]>(qk.selfReviews, (current) => {
    const list = current ?? []
    const at = list.findIndex((r) => r.review_id === sitting.review_id)
    return at < 0 ? [sitting, ...list] : list.map((r, i) => (i === at ? sitting : r))
  })
}

/**
 * Mark the SENT ledger stale after a share leaves.
 *
 * Same reasoning as invalidateSelfReviews above, and the same bug it was
 * written for: the query is gated on the Reviews tab being on screen, so a
 * refetch of it is silently skipped while the tab is elsewhere — which is
 * exactly where you are when you send matches from Matches. Without this a
 * share did not appear in the ledger until the app restarted.
 */
export function invalidateShareExports(): Promise<unknown> {
  return getQueryClient().invalidateQueries({ queryKey: qk.shares })
}
