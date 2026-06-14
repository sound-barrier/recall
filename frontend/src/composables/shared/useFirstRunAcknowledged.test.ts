import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'

const KEY = 'recall.firstRunAccountNamed'

// GetProfiles is fetched once per composable instance. The test
// double lets each case control the response (and timing) without
// touching the global `fetch` mock.
const profilesMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/api', () => ({
  GetProfiles: profilesMock.fn,
}))

import { useFirstRunAcknowledged } from '@/composables/shared/useFirstRunAcknowledged'

describe('useFirstRunAcknowledged', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
    profilesMock.fn.mockReset()
    // Default GetProfiles response: active profile is the default
    // 'main'. Tests that need a different active profile override
    // the mock.
    profilesMock.fn.mockResolvedValue({ active: 'main', profiles: ['main'] })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('defaults to false on a fresh install (no localStorage flag)', () => {
    const { acknowledged } = useFirstRunAcknowledged()
    expect(acknowledged.value).toBe(false)
  })

  it('reads true when the localStorage flag is set', () => {
    storage[KEY] = 'true'
    const { acknowledged } = useFirstRunAcknowledged()
    expect(acknowledged.value).toBe(true)
  })

  it('ack() flips the ref to true and persists', () => {
    const { acknowledged, ack } = useFirstRunAcknowledged()
    expect(acknowledged.value).toBe(false)
    ack()
    expect(acknowledged.value).toBe(true)
    expect(storage[KEY]).toBe('true')
  })

  it('falls back to false when localStorage getItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    const { acknowledged } = useFirstRunAcknowledged()
    expect(acknowledged.value).toBe(false)
  })

  it('ack() swallows setItem errors so private-mode users still proceed', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('SecurityError') },
    })
    const { acknowledged, ack } = useFirstRunAcknowledged()
    expect(() => ack()).not.toThrow()
    expect(acknowledged.value).toBe(true)
  })

  // ── Item 16: profile-name gate ───────────────────────────────────

  it('pending starts true on a fresh install (default profile, no ack)', async () => {
    const { pending } = useFirstRunAcknowledged()
    await nextTick()
    expect(pending.value).toBe(true)
  })

  it('pending flips false once GetProfiles reports a renamed profile', async () => {
    // User on a new device whose profile was already renamed elsewhere.
    profilesMock.fn.mockResolvedValue({ active: 'jacob', profiles: ['jacob'] })
    const { pending } = useFirstRunAcknowledged()
    expect(pending.value).toBe(true) // pre-fetch: assume default
    await Promise.resolve() // resolve the mocked promise
    await nextTick()
    expect(pending.value).toBe(false)
  })

  it('pending stays false when the localStorage flag was already set', () => {
    storage[KEY] = 'true'
    const { pending } = useFirstRunAcknowledged()
    expect(pending.value).toBe(false)
  })

  it('GetProfiles network failure leaves pending governed by localStorage', async () => {
    profilesMock.fn.mockRejectedValue(new Error('offline'))
    const { pending } = useFirstRunAcknowledged()
    await Promise.resolve()
    await nextTick()
    // Default profile assumption stays, so pending remains true on a
    // fresh install — the localStorage path still works on ack.
    expect(pending.value).toBe(true)
  })

  it('ack() flips pending to false even before GetProfiles resolves', () => {
    const { pending, ack } = useFirstRunAcknowledged()
    expect(pending.value).toBe(true)
    ack()
    expect(pending.value).toBe(false)
  })
})
