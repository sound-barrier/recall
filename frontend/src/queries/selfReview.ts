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

/** Re-read the shelf after a write that changes what it lists. */
export function refetchSelfReviews(): Promise<unknown> {
  return getQueryClient().refetchQueries({ queryKey: qk.selfReviews })
}

/** Put one sitting into the cached list — the room's writes keep the shelf honest without a round trip. */
export function upsertSelfReview(sitting: SelfReview): void {
  getQueryClient().setQueryData<SelfReview[]>(qk.selfReviews, (current) => {
    const list = current ?? []
    const at = list.findIndex((r) => r.review_id === sitting.review_id)
    return at < 0 ? [sitting, ...list] : list.map((r, i) => (i === at ? sitting : r))
  })
}
