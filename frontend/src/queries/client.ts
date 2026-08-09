import { QueryCache, QueryClient } from '@tanstack/vue-query'

import { plainLanguageError } from '@/error-helpers'
import { useAppStore } from '@/stores/app'

// Retry handlers keyed by query-key hash, created once per key so the
// banner's function-identity contract keeps working: the store clears the
// banner only when `errorRetry` IS the handler this query armed it with
// (the same way `load()` compared `errorRetry === load`).
const retryFns = new Map<string, () => void>()

function stableRetryFor(queryKey: readonly unknown[]): () => void {
  const hash = JSON.stringify(queryKey)
  let fn = retryFns.get(hash)
  if (!fn) {
    fn = () => { void queryClient.refetchQueries({ queryKey: queryKey as unknown[] }) }
    retryFns.set(hash, fn)
  }
  return fn
}

// The QueryClient defaults ARE today's request behavior, kept deliberately:
//
//  - retry: false — the app's retry UX is the error banner's Retry button;
//    automatic retries would delay surfacing and inflate the e2e
//    request-count assertions.
//  - staleTime/gcTime Infinity — nothing refetches on remount today. The
//    four views are v-if-mounted, so a default staleTime of 0 would fire
//    refetches on every tab switch, violating the "no network calls on
//    mount unless the user asked" rule. Refresh is explicit: invalidation
//    marks a query stale, and only then does remount/refetch fire. Cached
//    data must also outlive the last observer (gcTime) so a tab switch
//    doesn't drop state.
//  - refetchOnWindowFocus/Reconnect: false — the webview fires focus on
//    every alt-tab, and the backend is same-process (the asset server) or
//    localhost, so OS network transitions are irrelevant; SSE reconnect
//    has its own resync path (parse recovery).
//  - networkMode 'always' — with the default 'online', navigator.onLine
//    === false (an offline laptop is a normal state for this app) would
//    pause every query even though the local transport works fine.
//
// A query opts into the global error banner by carrying
// `meta: { banner: '<prefix>' }`; everything else keeps today's silent
// keep-last-data semantics.
function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const banner = query.meta?.banner
        if (typeof banner !== 'string') return
        useAppStore().setError(
          `${banner}: ${plainLanguageError(String(error))}`,
          stableRetryFor(query.queryKey),
        )
      },
      onSuccess: (_data, query) => {
        if (typeof query.meta?.banner !== 'string') return
        const app = useAppStore()
        if (app.errorRetry === retryFns.get(JSON.stringify(query.queryKey))) app.clearError()
      },
    }),
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: 'always',
      },
      mutations: {
        retry: false,
        networkMode: 'always',
      },
    },
  })
}

// The app-wide client. Query composables pass it explicitly (the second
// argument to useQuery/useMutation) instead of relying on inject():
// observers are created during Pinia store setup where the component
// injection context doesn't exist, and store tests keep their plain
// `setActivePinia(createPinia())` shape. main.ts still registers it with
// VueQueryPlugin so devtools and component-level useQueryClient() work.
export const queryClient = makeQueryClient()
