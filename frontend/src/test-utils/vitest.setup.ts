import { afterAll, vi } from 'vitest'

// Pinia stores statically import '@/api'; a store-using test (or one like
// api.test that just imports '@/api') caches the real module, so a later
// mountApp vi.doMock('@/api') can't reach an already-imported store — App.test
// then sees 0 GetMatchResults (file-order-dependent; surfaces in the coverage
// run). Reset the module registry once AFTER each test FILE so the next file
// starts from a clean import graph. afterAll (not afterEach) so it never resets
// mid-suite — api.test asserts `err instanceof ApiError` across static +
// dynamic '@/api' imports, which only holds within one module identity.
// See the reference_store_api_mock_isolation memory.
afterAll(() => { vi.resetModules() })
