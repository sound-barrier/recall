import { useQuery } from '@tanstack/vue-query'

import { GetOWData } from '@/api-client'
import { queryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// Reference data is compiled into the parser binary — static for the
// session, so the global staleTime: Infinity is exactly right. Every
// consumer shares one cache entry (one GET per session);
// ApplyGameDataUpdate invalidates the key to refresh the roster in place.
export function useOWDataQuery() {
  return useQuery({ queryKey: qk.system.referenceData, queryFn: GetOWData }, queryClient)
}
