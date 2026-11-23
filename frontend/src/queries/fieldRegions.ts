import { useQuery } from '@tanstack/vue-query'
import { toValue, type MaybeRefOrGetter } from 'vue'

import { GetMatchFieldRegions } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// Where on a match's own screenshots each field was read. Fetched per match,
// only while a review is on screen, and never in a coaching session (the
// caller gates it): a loaned match's key can name one of the coach's own
// matches, and the coach never loads the player's screenshots anyway.
//
// staleTime 0 against the client's Infinity default: regions change only when
// a parse re-reads the screenshot, which nothing here hears about, so a review
// mounting again reads them fresh rather than trusting a copy from before.
export function useFieldRegionsQuery(matchKey: string, enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: qk.fieldRegions(matchKey),
    queryFn: () => GetMatchFieldRegions(matchKey),
    enabled: () => toValue(enabled),
    staleTime: 0,
  }, getQueryClient())
}

/** Mark one match's regions stale — after a write that found the reading had changed under it. */
export function invalidateFieldRegions(matchKey: string): Promise<void> {
  return getQueryClient().invalidateQueries({ queryKey: qk.fieldRegions(matchKey) })
}
