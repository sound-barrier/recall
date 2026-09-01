import { beforeEach, describe, expect, it } from 'vitest'

import { useSessionBanner } from '@/composables/shared/useSessionBanner'
import { installMemoryLocalStorage } from '@/test-utils'

// The preference behind the live rail. Default OFF is the whole point — a
// fifth surface for the same session tally is the player's to opt into — so
// the default is what this pins, alongside the parse guard every persisted
// preference carries.

beforeEach(() => { installMemoryLocalStorage() })

describe('useSessionBanner', () => {
  it('is off until the player asks for it', () => {
    expect(useSessionBanner().sessionBanner.value).toBe(false)
  })

  it('remembers being switched on', () => {
    useSessionBanner().setSessionBanner(true)
    expect(localStorage.getItem('recall.sessionBanner')).toBe('true')
    expect(useSessionBanner().sessionBanner.value).toBe(true)
  })

  it('remembers being switched back off', () => {
    localStorage.setItem('recall.sessionBanner', 'true')
    useSessionBanner().setSessionBanner(false)
    expect(useSessionBanner().sessionBanner.value).toBe(false)
  })

  it('falls back to off when storage holds something unreadable', () => {
    // Not "truthy": a stray value must not switch a surface on that the
    // player never asked for.
    localStorage.setItem('recall.sessionBanner', 'yes')
    expect(useSessionBanner().sessionBanner.value).toBe(false)
  })
})
