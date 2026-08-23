import { useQuery } from '@tanstack/vue-query'
import { toValue, type MaybeRefOrGetter } from 'vue'

import { ListFocus, SetFocusItemStatus, type FocusStatus } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// What the player is working on. One read, assembled server-side out of both
// families that feed it: what a coach sent and what the player wrote in
// their own sittings. Coach items first — that ordering is the product
// decision, and keeping it on the server is what lets the band and the live
// readout agree without either re-deriving it.

/** Gated on the caller — the Reviews tab, or a widget the user opted into. */
export function useFocusQuery(enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: qk.focus,
    queryFn: ListFocus,
    enabled: () => toValue(enabled),
  }, getQueryClient())
}

/**
 * Mark the list stale after a write that moves an item. Invalidate rather
 * than refetch, for useSelfReviews' reason: the query is gated, and a
 * refetch of a disabled query is silently skipped.
 */
export function invalidateFocus(): Promise<unknown> {
  return getQueryClient().invalidateQueries({ queryKey: qk.focus })
}

/** Move an item along. Invalidates for the reason above. */
export async function setFocusItemStatus(itemID: string, status: FocusStatus): Promise<void> {
  await SetFocusItemStatus(itemID, status)
  await invalidateFocus()
}
