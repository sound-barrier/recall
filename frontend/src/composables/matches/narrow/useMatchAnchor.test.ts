import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, defineComponent, h } from 'vue'
import { render } from '@testing-library/vue'

import {
  useMatchAnchor,
  _resetMatchAnchorForTest,
  LEGACY_ANCHOR_STORAGE_KEY,
} from '@/composables/matches/narrow/useMatchAnchor'
import { cacheActiveProfile, profileScopedKey } from '@/composables/profile/profileStorage'

let storage: Record<string, string> = {}
function stubLocalStorage() {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },
    key: (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })
}

async function mountHost(): Promise<ReturnType<typeof useMatchAnchor>> {
  let api!: ReturnType<typeof useMatchAnchor>
  const Host = defineComponent({
    setup() {
      api = useMatchAnchor()
      return () => h('div')
    },
  })
  render(Host)
  await nextTick()
  return api
}

// The default-profile scoped key — no active-profile cache is seeded
// in these tests, so the fallback ("main") applies.
const scopedKey = () => profileScopedKey('matches.sinceAnchor')

describe('useMatchAnchor', () => {
  beforeEach(() => {
    stubLocalStorage()
    _resetMatchAnchorForTest()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with no anchor (empty string)', async () => {
    const api = await mountHost()
    expect(api.anchorKey.value).toBe('')
  })

  it('setAnchor persists to the profile-scoped key and updates the ref', async () => {
    const api = await mountHost()
    api.setAnchor('match-A')
    expect(api.anchorKey.value).toBe('match-A')
    expect(storage[scopedKey()]).toBe('match-A')
  })

  it('clearAnchor empties the ref and persists the empty value', async () => {
    const api = await mountHost()
    api.setAnchor('match-A')
    api.clearAnchor()
    expect(api.anchorKey.value).toBe('')
    expect(storage[scopedKey()]).toBe('')
  })

  it('hydrates from the profile-scoped key on mount', async () => {
    storage[scopedKey()] = 'match-Z'
    const api = await mountHost()
    expect(api.anchorKey.value).toBe('match-Z')
  })

  // The anchor references a match_key that exists only in one
  // profile's DB (ledger section 10): profile A's anchor must never
  // leak into profile B, where it matches nothing or the wrong match.
  it('does not leak an anchor across profiles', async () => {
    cacheActiveProfile('alpha')
    const api = await mountHost()
    api.setAnchor('match-A')

    cacheActiveProfile('beta')
    _resetMatchAnchorForTest()
    const beta = await mountHost()
    expect(beta.anchorKey.value).toBe('')
  })

  // One-way adoption: an install upgrading from the global-key era
  // keeps its anchor (it belonged to the only profile in practice).
  it('adopts a legacy global-key anchor when the scoped key is empty', async () => {
    storage[LEGACY_ANCHOR_STORAGE_KEY] = 'match-legacy'
    const api = await mountHost()
    expect(api.anchorKey.value).toBe('match-legacy')
  })

  it('is a module singleton — second call returns the same api', async () => {
    const first = await mountHost()
    first.setAnchor('match-A')
    // A second call without _resetMatchAnchorForTest gives the same cached instance.
    const second = useMatchAnchor()
    expect(second).toBe(first)
    expect(second.anchorKey.value).toBe('match-A')
  })
})
