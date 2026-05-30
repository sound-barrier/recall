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

  it('returns "night" when matchMedia says prefers-color-scheme: dark', () => {
    stubMatchMedia(true)
    expect(detectSystemPreference()).toBe('night')
  })

  it('returns "day" when matchMedia says prefers-color-scheme: light', () => {
    stubMatchMedia(false)
    expect(detectSystemPreference()).toBe('day')
  })

  it('returns "night" when matchMedia is absent (SSR / older sandbox)', () => {
    vi.stubGlobal('window', { matchMedia: undefined })
    expect(detectSystemPreference()).toBe('night')
  })

  it('returns "night" when matchMedia throws', () => {
    vi.stubGlobal('window', {
      matchMedia: () => { throw new Error('CSP-blocked') },
    })
    expect(detectSystemPreference()).toBe('night')
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
    expect(readStoredTheme()).toBe('night')
  })

  it('returns the OS preference when nothing is stored (fresh install, light OS)', () => {
    stubMatchMedia(false)
    expect(readStoredTheme()).toBe('day')
  })

  it('returns "day" when day is stored (user pick wins over OS)', () => {
    stubMatchMedia(true) // OS says dark, user picked day
    storage[THEME_STORAGE_KEY] = 'day'
    expect(readStoredTheme()).toBe('day')
  })

  it('returns "night" when night is stored', () => {
    storage[THEME_STORAGE_KEY] = 'night'
    expect(readStoredTheme()).toBe('night')
  })

  it('returns "dark" when dark is stored (OW gray palette)', () => {
    storage[THEME_STORAGE_KEY] = 'dark'
    expect(readStoredTheme()).toBe('dark')
  })

  it('returns "high-contrast" when high-contrast is stored', () => {
    stubMatchMedia(false) // OS preference is irrelevant once stored
    storage[THEME_STORAGE_KEY] = 'high-contrast'
    expect(readStoredTheme()).toBe('high-contrast')
  })

  it('migrates legacy "light" (the removed editorial light) to "day"', () => {
    storage[THEME_STORAGE_KEY] = 'light'
    expect(readStoredTheme()).toBe('day')
  })

  it('migrates legacy "ow-light" to "day"', () => {
    storage[THEME_STORAGE_KEY] = 'ow-light'
    expect(readStoredTheme()).toBe('day')
  })

  it('does NOT migrate "dark" — the string is reused by the new OW-gray palette', () => {
    // Pre-rename, "dark" was the editorial darkroom palette. Now it
    // resolves to the OW-gray palette ("Dark" in the picker). Old
    // editorial-dark users silently land on the new palette; this
    // is the documented trade-off for keeping the "dark" string
    // valid for post-rename picks.
    storage[THEME_STORAGE_KEY] = 'dark'
    expect(readStoredTheme()).toBe('dark')
  })

  it('migrates legacy "ow-dark" to "dark"', () => {
    storage[THEME_STORAGE_KEY] = 'ow-dark'
    expect(readStoredTheme()).toBe('dark')
  })

  it('falls back to the OS preference for invalid stored values', () => {
    stubMatchMedia(false)
    storage[THEME_STORAGE_KEY] = 'solarized'
    expect(readStoredTheme()).toBe('day')
  })

  it('falls back to the OS preference when localStorage throws', () => {
    stubMatchMedia(false)
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage unavailable') },
    })
    expect(readStoredTheme()).toBe('day')
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

  it('sets data-theme="day" on the document root', () => {
    applyTheme('day')
    expect(attrs['data-theme']).toBe('day')
  })

  it('sets data-theme="dark" on the document root', () => {
    applyTheme('dark')
    expect(attrs['data-theme']).toBe('dark')
  })

  it('sets data-theme="night" on the document root', () => {
    applyTheme('night')
    expect(attrs['data-theme']).toBe('night')
  })

  it('sets data-theme="high-contrast" on the document root', () => {
    applyTheme('high-contrast')
    expect(attrs['data-theme']).toBe('high-contrast')
  })

  it('overwrites a previous value', () => {
    applyTheme('night')
    applyTheme('day')
    expect(attrs['data-theme']).toBe('day')
  })
})
