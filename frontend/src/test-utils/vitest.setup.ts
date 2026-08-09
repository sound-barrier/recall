import { afterAll, afterEach, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

// Unmount every test-utils wrapper after its test. Without this, mounted
// components from earlier tests stay subscribed to the singleton query
// cache — and a still-mounted observer resurrects a cleared query with its
// last-known data (staleTime Infinity then suppresses the refetch), so a
// later test's api mock never gets called.
enableAutoUnmount(afterEach)

// Fallback fetch for anything a test didn't stub. Two rules:
//
//  1. The reference-data fetch (useOWData) resolves with an empty
//     roster so it can't slip past the @/api-client mock — the old
//     App.test "mounts without throwing" ECONNREFUSED timeout.
//  2. EVERYTHING ELSE resolves as an inert 503 instead of dialing a
//     real socket. Nothing listens on happy-dom's localhost:3000, so
//     a request that reaches this layer could only ever fail — and
//     under the coverage run's low fork count, a leaked un-awaited
//     request's ECONNREFUSED landed AFTER its test file finished and
//     vitest failed the whole run on the unhandled rejection (the
//     api.test :3000 flake, second sighting). An immediately-resolved
//     503 keeps leaked requests inert and awaited ones deterministic;
//     the console.error keeps the leak visible so it can be mocked
//     properly at its source.
//
// Set on globalThis directly (NOT via vi.stubGlobal) so api.test's
// per-test vi.stubGlobal('fetch') still overrides + restores this on
// unstub.
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = input instanceof Request ? input.url : String(input)
  if (url.includes('/system/reference-data')) {
    // The hey-api client reads the body via text() and content-type via
    // headers — keep all three response views serving the same payload.
    const payload = { heroes_by_role: {}, maps_by_game_mode: {}, screenshot_sources: [], seasons: [] }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }
  }
  console.error('[vitest.setup] unmocked fetch in a unit test (resolved as 503):', url)
  return {
    ok: false,
    status: 503,
    headers: { get: () => null },
    text: async () => 'unit-test network disabled',
    json: async () => ({}),
  }
}) as unknown as typeof fetch

// Query-cache isolation. The app-wide QueryClient is a module singleton
// with staleTime/gcTime Infinity — without a clear, the first test in a
// file fills the cache and every later test reads that stale entry no
// matter what it mocked (the pre-query code fetched per mount). Clearing
// per TEST restores those semantics; mountApp additionally gets a whole
// fresh client via its vi.resetModules().
afterEach(async () => {
  const { queryClient } = await import('@/queries/client')
  queryClient.clear()
})

// Cross-file '@/api' isolation. After each test FILE, drop both the module
// cache AND any '@/api' mock registration so the next file starts clean:
//
//  - resetModules: a store-/api-importing file caches the module; without a
//    reset a later mountApp vi.doMock('@/api') can't reach an already-imported
//    store (App.test then sees 0 GetMatchResults).
//  - doUnmock: a file with a HOISTED vi.mock('@/api') (MatchesView.test, the
//    profile/event-stream tests) leaves the mock *registration* in place —
//    resetModules clears the cache but not the registration, so a later file's
//    '@/api' re-resolves to that stale mock. (mountApp also doUnmocks at mount
//    as a second line of defence.)
//
// afterAll (not afterEach) so it never fires mid-suite and breaks api.test's
// static-vs-dynamic `instanceof ApiError`, which only holds within one module
// identity. Surfaces only under low fork counts (CI's coverage run). See the
// reference_store_api_mock_isolation memory.
afterAll(() => {
  vi.doUnmock('@/api')
  vi.resetModules()
})
