import { afterAll, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/vue'
// Registers the jest-dom matchers (toBeInTheDocument, toBeDisabled, …)
// on vitest's expect. Static import is safe: it touches only the
// matcher registry, never the @/api module graph.
import '@testing-library/jest-dom/vitest'

// Testing Library teardown. TL only auto-registers its cleanup when
// test.globals is set (it isn't here), so the explicit hook is
// mandatory — without it every render()'s container div stays in
// document.body, screen queries start matching stale DOM from earlier
// tests in the same file, and listeners/timers pile up.
afterEach(cleanup)

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

// Query-cache isolation. The app-wide QueryClient caches with
// staleTime/gcTime Infinity, so without a reset the first test in a file
// fills the cache and every later test reads that stale entry no matter
// what it mocked (the pre-query code fetched per mount). A fresh CLIENT
// per test — not a .clear() — is what makes this airtight: observers left
// behind by an earlier test keep pointing at the discarded client and
// can't resurrect an entry in the new one. getQueryClient/resetQueryClient
// address a globalThis slot, so this reaches the same client even in files
// that run vi.resetModules().
// Imported dynamically, at teardown: a STATIC import here would pull the
// whole app module graph (client → app store → @/api) into every test file
// before its own hoisted vi.mock('@/api') could apply — the module-mock
// leak reference_store_api_mock_isolation documents. Resolving a different
// module instance is harmless now: every instance addresses the same
// globalThis slot.
afterEach(async () => {
  const { resetQueryClient } = await import('@/queries/client')
  resetQueryClient()
})

// Cross-file '@/api' isolation. After each test FILE, drop both the module
// cache AND any '@/api' mock registration so the next file starts clean:
//
//  - resetModules: a store-/api-importing file caches the module; without a
//    reset a later renderApp run can't reach an already-imported store
//    (App.test then sees 0 GetMatchResults).
//  - doUnmock: a file with a HOISTED vi.mock('@/api') (MatchesView.test, the
//    profile/event-stream tests) leaves the mock *registration* in place —
//    resetModules clears the cache but not the registration, so a later file's
//    '@/api' re-resolves to that stale mock.
//
// afterAll (not afterEach) so it never fires mid-suite and breaks api.test's
// static-vs-dynamic `instanceof ApiError`, which only holds within one module
// identity. Surfaces only under low fork counts (CI's coverage run). See the
// reference_store_api_mock_isolation memory.
afterAll(() => {
  vi.doUnmock('@/api')
  vi.resetModules()
})
