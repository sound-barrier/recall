import { useQuery } from '@tanstack/vue-query'

import { GetFailedFiles, GetMatchResults, GetNewScreenshotCount } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { matchesCluster, qk } from '@/queries/keys'

// The match records — source of truth for the dossier + all four views.
// The one read that surfaces failures on the global banner (with a Retry
// that refetches this key); the sibling cluster reads stay silent
// keep-last, exactly like the old load()'s Promise.allSettled split.
export function useMatchesQuery() {
  return useQuery({
    queryKey: qk.matches,
    queryFn: GetMatchResults,
    // retryKeys: the banner's Retry heals the WHOLE cluster, matching the
    // old load()-as-retry behavior — without it, pending-count and
    // failed-files would stay at their failed defaults after an outage.
    meta: { banner: 'Could not load matches', retryKeys: matchesCluster },
  }, getQueryClient())
}

// Re-read the pending-screenshot count. Refetching a query is query-layer
// work, so it lives here rather than on a store: the settings store needs it
// the moment the watched folder changes, and reaching through the parse store
// to get it was one half of a store<->store import cycle.
export async function refetchPendingCount(): Promise<void> {
  await getQueryClient().refetchQueries({ queryKey: qk.pendingCount })
}

export function usePendingCountQuery() {
  return useQuery({ queryKey: qk.pendingCount, queryFn: GetNewScreenshotCount }, getQueryClient())
}

export function useFailedFilesQuery() {
  return useQuery({
    queryKey: qk.failedFiles,
    queryFn: async () => (await GetFailedFiles()) ?? [],
  }, getQueryClient())
}

// Refetch the whole cluster — the replacement for the old load(): awaited
// by mutation handlers and the parse-complete path so "reload then
// continue" ordering is preserved. refetchQueries settles rather than
// throwing; per-query failures surface through each query's own state
// (the banner meta for matches, keep-last for the rest).
export async function refetchMatchesCluster(): Promise<void> {
  await Promise.all(
    matchesCluster.map(key => getQueryClient().refetchQueries({ queryKey: key })),
  )
}
