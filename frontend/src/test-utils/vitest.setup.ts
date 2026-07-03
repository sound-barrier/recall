import { afterAll, vi } from 'vitest'

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
    return {
      ok: true,
      status: 200,
      json: async () => ({ heroes_by_role: {}, maps_by_game_mode: {} }),
      text: async () => '{}',
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
