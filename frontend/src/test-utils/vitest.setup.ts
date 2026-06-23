import { afterAll, vi } from 'vitest'

// Short-circuit ONLY the reference-data fetch (useOWData) so it can't slip past
// the @/api-client mock and hang on a real http://localhost:3000 connection
// under the low-fork coverage run — the App.test "mounts without throwing"
// ECONNREFUSED timeout. Every other request passes through unchanged, so
// endpoint-specific test mocks (e.g. the profiles list) keep their own shapes.
// Set on globalThis directly (NOT via vi.stubGlobal) so api.test's per-test
// vi.stubGlobal('fetch') still overrides + restores this on unstub.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = input instanceof Request ? input.url : String(input)
  if (url.includes('/system/reference-data')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ heroes_by_role: {}, maps_by_game_mode: {} }),
      text: async () => '{}',
    }
  }
  return realFetch(input, init)
}) as unknown as typeof fetch

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
