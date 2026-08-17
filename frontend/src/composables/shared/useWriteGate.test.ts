import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// The gate ORs two independent locks, so both halves are stubbed: the
// read-only sample profile (a query-backed flag) and the coaching session
// (a Pinia store). Refs so a case can flip either one.
const readOnly = ref(false)
const sessionActive = ref(false)

vi.mock('@/composables/profile/useActiveProfile', () => ({
  useActiveProfile: () => ({ isReadOnly: readOnly }),
}))
vi.mock('@/stores/coach', () => ({
  useCoachStore: () => ({
    get sessionActive() { return sessionActive.value },
  }),
}))

import {
  READ_ONLY_LOCK_REASON,
  SESSION_LOCK_REASON,
  useWriteGate,
} from '@/composables/shared/useWriteGate'

function gate(opts: { readOnly?: boolean; session?: boolean } = {}) {
  readOnly.value = opts.readOnly ?? false
  sessionActive.value = opts.session ?? false
  return useWriteGate()
}

describe('useWriteGate', () => {
  it('leaves writes open on a writable profile with no session', () => {
    const { writesLocked, lockReason, sessionActive: active, guardWrite } = gate()
    expect(writesLocked.value).toBe(false)
    expect(active.value).toBe(false)
    expect(lockReason.value).toBe('')
    expect(guardWrite()).toBe(true)
  })

  it('locks writes on the read-only sample profile', () => {
    const { writesLocked, lockReason, guardWrite } = gate({ readOnly: true })
    expect(writesLocked.value).toBe(true)
    expect(lockReason.value).toBe(READ_ONLY_LOCK_REASON)
    expect(guardWrite()).toBe(false)
  })

  it('locks writes while a coaching session is open', () => {
    const { writesLocked, lockReason, sessionActive: active, guardWrite } = gate({ session: true })
    expect(writesLocked.value).toBe(true)
    expect(active.value).toBe(true)
    expect(lockReason.value).toBe(SESSION_LOCK_REASON)
    expect(lockReason.value).toMatch(/end the session/i)
    expect(guardWrite()).toBe(false)
  })

  it('names the session first when both locks apply — it is the one the user can lift', () => {
    const { lockReason } = gate({ readOnly: true, session: true })
    expect(lockReason.value).toBe(SESSION_LOCK_REASON)
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
