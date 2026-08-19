import { useQuery } from '@tanstack/vue-query'
import { toValue, type MaybeRefOrGetter } from 'vue'

import { ListSelfReviews, type SelfReview } from '@/api-client'
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
