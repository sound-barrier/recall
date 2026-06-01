import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

import { useFirstRunAcknowledged } from './useFirstRunAcknowledged'

const KEY = 'recall.firstRunAccountNamed'

describe('useFirstRunAcknowledged', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
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
})
