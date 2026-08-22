import { QueryCache, QueryClient } from '@tanstack/vue-query'

import { plainLanguageError } from '@/error-helpers'

// Where a banner-carrying query reports failure. `queries/` is the cache
// layer: it knows a request failed and which Retry would heal it, but not
// what a banner is or who renders one. Importing the app store to call
// setError() inverted that — the cache reached up into the shell — and put
// this module inside a 17-cycle knot (client -> app -> queries/system ->
// client). The shell registers itself here instead; nothing is reported
// until it does, which is what SHOULD happen when there is no UI to report to.
export type QueryBannerSink = {
  raise(message: string, retry: () => Promise<void>): void
  clearIfArmedBy(retry: (() => Promise<void>) | undefined): void
}

let bannerSink: QueryBannerSink | null = null

export function setQueryBannerSink(sink: QueryBannerSink | null): void {
  bannerSink = sink
}

// Retry handlers keyed by query-key hash, created once per key so the
// banner's function-identity contract keeps working: the store clears the
// banner only when `errorRetry` IS the handler this query armed it with
// (the same way `load()` compared `errorRetry === load`). A query whose
// old-world Retry re-ran a wider loader declares that scope via
// `meta.retryKeys` (the matches query lists its whole cluster — Retry must
// heal pending-count/failed-files too, exactly like the old load()).
const retryFns = new Map<string, () => Promise<void>>()

function stableRetryFor(queryKey: readonly unknown[], retryKeys?: unknown): () => Promise<void> {
  const hash = JSON.stringify(queryKey)
  let fn = retryFns.get(hash)
  if (!fn) {
    const keys = Array.isArray(retryKeys) && retryKeys.length > 0
      ? (retryKeys as readonly unknown[][])
      : [queryKey]
    fn = async () => {
      await Promise.all(keys.map(k => getQueryClient().refetchQueries({ queryKey: k as unknown[] })))
    }
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
        bannerSink?.raise(
          `${banner}: ${plainLanguageError(String(error))}`,
          stableRetryFor(query.queryKey, query.meta?.retryKeys),
        )
      },
      onSuccess: (_data, query) => {
        if (typeof query.meta?.banner !== 'string') return
        bannerSink?.clearIfArmedBy(retryFns.get(JSON.stringify(query.queryKey)))
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

// The app-wide client, resolved at CALL time — never captured in a
// module-level `const`. Query composables pass it explicitly (the second
// argument to useQuery/useMutation) instead of relying on inject():
// observers are created during Pinia store setup where the component
// injection context doesn't exist, and store tests keep their plain
// `setActivePinia(createPinia())` shape. main.ts still registers it with
// VueQueryPlugin so devtools and component-level useQueryClient() work.
//
// It lives in a globalThis slot rather than a module variable so that a
// test file running `vi.resetModules()` cannot end up with TWO clients —
// one held by the freshly-imported components, another by whatever
// imported this module earlier. That split is not hypothetical: it cost
// an afternoon when a test's cache clear silently addressed a different
// instance than its components used. The slot is the same
// resolve-at-call-time trick the `@/api-client` seam uses for api
// functions, for the same reason.
const CLIENT_SLOT = Symbol.for('recall.queryClient')

type ClientSlot = { [CLIENT_SLOT]?: QueryClient }

export function getQueryClient(): QueryClient {
  const slot = globalThis as ClientSlot
  slot[CLIENT_SLOT] ??= makeQueryClient()
  return slot[CLIENT_SLOT]
}

// Test-only: drop the current client (and everything cached in it) and
// install a fresh one, so each test starts from an empty cache. Observers
// created by an earlier test keep pointing at the discarded client, which
// is exactly the isolation a plain `.clear()` failed to give.
export function resetQueryClient(): void {
  ;(globalThis as ClientSlot)[CLIENT_SLOT] = makeQueryClient()
}
