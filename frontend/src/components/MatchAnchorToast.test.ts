import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

import MatchAnchorToast from './MatchAnchorToast.vue'

type ToastState = { kind: 'set' | 'cleared'; label: string; token: number } | null

const wrappers: VueWrapper[] = []
function mountToast(state: ToastState) {
  const w = mount(MatchAnchorToast, { props: { state }, attachTo: document.body })
  wrappers.push(w)
  return w
}

describe('MatchAnchorToast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    // Teleport renders into <body>; unmount tears down the teleported
    // node, but state from a previous mount could leak across tests.
    // Drain defensively.
    while (wrappers.length) wrappers.pop()!.unmount()
  })

  it('renders nothing when state is null', () => {
    mountToast(null)
    expect(document.body.querySelector('[data-anchor-toast]')).toBeNull()
  })

  it('renders the set copy + view-filter action when state.kind is "set"', () => {
    mountToast({ kind: 'set', label: '2026-05-03 · rialto', token: 1 })
    const toast = document.body.querySelector('[data-anchor-toast]')!
    expect(toast).not.toBeNull()
    expect(toast.textContent).toMatch(/reference set/i)
    expect(toast.textContent).toMatch(/2026-05-03/)
    expect(toast.querySelector('[data-anchor-toast-view]')).not.toBeNull()
  })

  it('renders the cleared copy and NO view-filter action when state.kind is "cleared"', () => {
    mountToast({ kind: 'cleared', label: '', token: 2 })
    const toast = document.body.querySelector('[data-anchor-toast]')!
    expect(toast.textContent).toMatch(/reference cleared/i)
    expect(toast.querySelector('[data-anchor-toast-view]')).toBeNull()
  })

  it('emits view-filter when the "View filter" button is clicked (set state)', () => {
    const w = mountToast({ kind: 'set', label: 'x', token: 3 })
    const btn = document.body.querySelector('[data-anchor-toast-view]') as HTMLButtonElement
    btn.click()
    expect(w.emitted('view-filter')).toBeTruthy()
  })

  it('emits dismiss when the × is clicked', () => {
    const w = mountToast({ kind: 'set', label: 'x', token: 4 })
    const dismiss = document.body.querySelector('[data-anchor-toast-dismiss]') as HTMLButtonElement
    dismiss.click()
    expect(w.emitted('dismiss')).toBeTruthy()
    expect(w.emitted('dismiss')![0]).toEqual([4])
  })

  it('auto-dismisses after the auto-dismiss window', () => {
    const w = mountToast({ kind: 'set', label: 'x', token: 5 })
    vi.advanceTimersByTime(4600)
    expect(w.emitted('dismiss')).toBeTruthy()
    expect(w.emitted('dismiss')![0]).toEqual([5])
  })

  it('a new token resets the auto-dismiss countdown', async () => {
    const w = mountToast({ kind: 'set', label: 'a', token: 1 })
    vi.advanceTimersByTime(3000)
    await w.setProps({ state: { kind: 'set', label: 'b', token: 2 } })
    // 3s after the SECOND token — should not have fired yet (window is ~4.5s).
    vi.advanceTimersByTime(3000)
    expect(w.emitted('dismiss')).toBeFalsy()
    // Past the window from the second token — fires once.
    vi.advanceTimersByTime(2000)
    expect(w.emitted('dismiss')!.length).toBe(1)
    expect(w.emitted('dismiss')![0]).toEqual([2])
  })
})
