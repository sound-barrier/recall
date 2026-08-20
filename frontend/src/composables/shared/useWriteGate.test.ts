import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// The gate holds ONE lock — the coaching session (a Pinia store) — stubbed
// as a ref so a case can flip it. (The read-only sample-profile lock is
// gone: the tour's sample is a writable sandbox.)
const sessionActive = ref(false)

vi.mock('@/stores/coach', () => ({
  useCoachStore: () => ({
    get sessionActive() { return sessionActive.value },
  }),
}))

import {
  SESSION_LOCK_REASON,
  useWriteGate,
} from '@/composables/shared/useWriteGate'

function gate(opts: { session?: boolean } = {}) {
  sessionActive.value = opts.session ?? false
  return useWriteGate()
}

describe('useWriteGate', () => {
  it('leaves writes open with no session', () => {
    const { writesLocked, lockReason, guardWrite } = gate()
    expect(writesLocked.value).toBe(false)
    expect(lockReason.value).toBe('')
    expect(guardWrite()).toBe(true)
  })

  it('locks writes while a coaching session is open', () => {
    const { writesLocked, lockReason, guardWrite, sessionActive: active } = gate({ session: true })
    expect(writesLocked.value).toBe(true)
    expect(active.value).toBe(true)
    expect(lockReason.value).toBe(SESSION_LOCK_REASON)
    expect(guardWrite()).toBe(false)
  })

  it('tracks a lock that flips after the gate was created', () => {
    const { writesLocked, guardWrite } = gate()
    expect(guardWrite()).toBe(true)
    sessionActive.value = true
    expect(writesLocked.value).toBe(true)
    expect(guardWrite()).toBe(false)
  })

  it('lockedTitle swaps the affordance title for the reason while locked', () => {
    const open = gate()
    expect(open.lockedTitle('Merge matches from a bundle')).toBe('Merge matches from a bundle')
    const locked = gate({ session: true })
    expect(locked.lockedTitle('Merge matches from a bundle')).toBe(SESSION_LOCK_REASON)
  })
})
