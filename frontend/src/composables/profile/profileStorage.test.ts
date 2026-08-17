import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  ACTIVE_PROFILE_CACHE_KEY,
  cacheActiveProfile,
  profileScopedKey,
} from '@/composables/profile/profileStorage'

// Per-profile localStorage scoping (ledger section 10): keys that
// reference a profile's DATA (the since-anchor match_key, the
// last-parse timestamp) were global while the UI presents them as
// per-profile — switching profiles carried profile A's anchor into
// profile B, where it matches nothing or the wrong match. Scoped keys
// derive from a synchronously-readable active-profile cache because
// the persisted-pref composables hydrate at setup time, before any
// API call can resolve the active profile.

let storage: Record<string, string>

describe('profileStorage', () => {
  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
      removeItem: (key: string) => { delete storage[key] },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('falls back to the install default profile before the cache is first written', () => {
    // "main" is pkg/app/profile.go's DefaultProfileName — the fresh-
    // install profile every un-renamed install runs as.
    expect(profileScopedKey('lastParsedAt')).toBe('recall.profiles.main.lastParsedAt')
  })

  it('scopes keys to the cached active profile', () => {
    cacheActiveProfile('smurf')
    expect(profileScopedKey('lastParsedAt')).toBe('recall.profiles.smurf.lastParsedAt')
    expect(profileScopedKey('matches.sinceAnchor')).toBe('recall.profiles.smurf.matches.sinceAnchor')
  })

  it('round-trips the cache through localStorage', () => {
    cacheActiveProfile('alt')
    expect(storage[ACTIVE_PROFILE_CACHE_KEY]).toBe('alt')
  })

  it('ignores an empty profile name so a failed lookup cannot poison the scope', () => {
    cacheActiveProfile('smurf')
    cacheActiveProfile('')
    expect(profileScopedKey('x')).toBe('recall.profiles.smurf.x')
  })
})
