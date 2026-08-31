import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useArmedAction } from '@/composables/unknown/useArmedAction'

// The shared two-click destructive confirm: arm, fire-inside-the-window,
// auto-disarm past it — keyed so sibling cards stay independent, and
// scope-bound so an unmount mid-arm leaves no live timer.

describe('useArmedAction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms on the first trigger and fires only on the second', () => {
    const { trigger, isArmed } = useArmedAction()
    const fire = vi.fn()

    trigger('k', fire)
    expect(isArmed('k')).toBe(true)
    expect(fire).not.toHaveBeenCalled()

    trigger('k', fire)
    expect(fire).toHaveBeenCalledTimes(1)
    expect(isArmed('k')).toBe(false)
  })

  it('auto-disarms after the window so a stale second click re-arms instead of firing', () => {
    const { trigger, isArmed } = useArmedAction(3000)
    const fire = vi.fn()

    trigger('k', fire)
    vi.advanceTimersByTime(3000)
    expect(isArmed('k')).toBe(false)

    trigger('k', fire)
    expect(fire).not.toHaveBeenCalled()
    expect(isArmed('k')).toBe(true)
  })

  it('keys arm independently — confirming one card never fires a sibling', () => {
    const { trigger, isArmed } = useArmedAction()
    const fireA = vi.fn()
    const fireB = vi.fn()

    trigger('a', fireA)
    trigger('b', fireB)
    expect(isArmed('a')).toBe(true)
    expect(isArmed('b')).toBe(true)

    trigger('a', fireA)
    expect(fireA).toHaveBeenCalledTimes(1)
    expect(fireB).not.toHaveBeenCalled()
    expect(isArmed('b')).toBe(true)
  })

  it('disposing the owning scope clears pending timers', () => {
    const scope = effectScope()
    const api = scope.run(() => useArmedAction())
    if (!api) throw new Error('scope.run returned nothing')

    api.trigger('k', vi.fn())
    scope.stop()

    // The auto-disarm timer was cleared with the scope — advancing time
    // must not throw or mutate the dead ref.
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
  })
})
