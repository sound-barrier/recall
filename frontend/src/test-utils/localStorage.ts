import { vi } from 'vitest'

// happy-dom's `localStorage` is absent in this version, and every
// persisted-preference composable guards its reads in a try/catch — so
// without a stand-in, a test that seeds a preference asserts nothing and
// still passes. This installs a real in-memory one for the current test.
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
