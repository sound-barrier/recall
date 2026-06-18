import { afterAll, vi } from 'vitest'

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
