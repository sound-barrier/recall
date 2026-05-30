import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readStoredTheme, applyTheme, detectSystemPreference, THEME_STORAGE_KEY } from './useTheme'

// Tests for the pure helper functions exported from useTheme.
// These cover the business logic without needing a mounted Vue component
// or a DOM environment — vi.stubGlobal mocks localStorage and document.

function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal('window', {
    ...window,
    matchMedia: (q: string) => ({
      matches: q.includes('dark') ? prefersDark : !prefersDark,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

describe('detectSystemPreference', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns "dark" when matchMedia says prefers-color-scheme: dark', () => {
    stubMatchMedia(true)
    expect(detectSystemPreference()).toBe('dark')
  })

  it('returns "light" when matchMedia says prefers-color-scheme: light', () => {
    stubMatchMedia(false)
    expect(detectSystemPreference()).toBe('light')
  })

  it('returns "dark" when matchMedia is absent (SSR / older sandbox)', () => {
    vi.stubGlobal('window', { matchMedia: undefined })
    expect(detectSystemPreference()).toBe('dark')
  })

  it('returns "dark" when matchMedia throws', () => {
    vi.stubGlobal('window', {
      matchMedia: () => { throw new Error('CSP-blocked') },
    })
    expect(detectSystemPreference()).toBe('dark')
  })
})

describe('readStoredTheme', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
    // Default matchMedia stub for the storage tests — pretend OS is dark.
    stubMatchMedia(true)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns the OS preference when nothing is stored (fresh install, dark OS)', () => {
    stubMatchMedia(true)
    expect(readStoredTheme()).toBe('dark')
  })

  it('returns the OS preference when nothing is stored (fresh install, light OS)', () => {
    stubMatchMedia(false)
    expect(readStoredTheme()).toBe('light')
  })

  it('returns "light" when light is stored (user pick wins over OS)', () => {
    stubMatchMedia(true) // OS says dark, user picked light
    storage[THEME_STORAGE_KEY] = 'light'
    expect(readStoredTheme()).toBe('light')
  })

  it('returns "dark" when dark is stored', () => {
    storage[THEME_STORAGE_KEY] = 'dark'
    expect(readStoredTheme()).toBe('dark')
  })

  it('returns "high-contrast" when high-contrast is stored', () => {
    stubMatchMedia(false) // OS preference is irrelevant once stored
    storage[THEME_STORAGE_KEY] = 'high-contrast'
    expect(readStoredTheme()).toBe('high-contrast')
  })

  it('returns "ow-light" when ow-light is stored', () => {
    stubMatchMedia(false)
    storage[THEME_STORAGE_KEY] = 'ow-light'
    expect(readStoredTheme()).toBe('ow-light')
  })

  it('returns "ow-dark" when ow-dark is stored', () => {
    stubMatchMedia(true)
    storage[THEME_STORAGE_KEY] = 'ow-dark'
    expect(readStoredTheme()).toBe('ow-dark')
  })

  it('falls back to the OS preference for invalid stored values', () => {
    stubMatchMedia(false)
    storage[THEME_STORAGE_KEY] = 'solarized'
    expect(readStoredTheme()).toBe('light')
  })

  it('falls back to the OS preference when localStorage throws', () => {
    stubMatchMedia(false)
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage unavailable') },
    })
    expect(readStoredTheme()).toBe('light')
  })
})

describe('applyTheme', () => {
  let attrs: Record<string, string>

  beforeEach(() => {
    attrs = {}
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (name: string, value: string) => { attrs[name] = value },
      },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('sets data-theme="dark" on the document root', () => {
    applyTheme('dark')
    expect(attrs['data-theme']).toBe('dark')
  })

  it('sets data-theme="light" on the document root', () => {
    applyTheme('light')
    expect(attrs['data-theme']).toBe('light')
  })

  it('sets data-theme="high-contrast" on the document root', () => {
    applyTheme('high-contrast')
    expect(attrs['data-theme']).toBe('high-contrast')
  })

  it('sets data-theme="ow-light" on the document root', () => {
    applyTheme('ow-light')
    expect(attrs['data-theme']).toBe('ow-light')
  })

  it('sets data-theme="ow-dark" on the document root', () => {
    applyTheme('ow-dark')
    expect(attrs['data-theme']).toBe('ow-dark')
  })

  it('overwrites a previous value', () => {
    applyTheme('dark')
    applyTheme('light')
    expect(attrs['data-theme']).toBe('light')
  })
})
