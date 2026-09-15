import { vi } from 'vitest'

// Under Vitest 4 on Node 26, happy-dom's `localStorage` was shadowed by
// Node's unusable one, and every persisted-preference composable guards
// its reads in a try/catch — so without a stand-in, a test that seeded a
// preference asserted nothing and still passed. Vitest 5 exposes the real
// Storage (vitest.setup.ts clears it per test); this still installs an
// EMPTY in-memory one, which is what a first-run test wants — the setup
// file pre-seeds onboarding as completed.
//
// It lived as a private copy in renderApp and renderWidget, and as a
// hand-rolled literal in three dozen test files, before the third copy
// earned the extraction. New tests that seed a preference call this.
export function installMemoryLocalStorage(): void {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem:    (key: string) => storage.get(key) ?? null,
    setItem:    (key: string, value: string) => { storage.set(key, String(value)) },
    removeItem: (key: string) => { storage.delete(key) },
    clear:      () => { storage.clear() },
    key:        (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
  })
}
