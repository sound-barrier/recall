import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import DashboardUndoToast from '@/components/DashboardUndoToast.vue'

function trashed(opts: Partial<{ id: string; eyebrow: string; row: number; idx: number; token: number }> = {}) {
  return {
    id: opts.id ?? 'winrate',
    eyebrow: opts.eyebrow ?? 'Winrate',
    row: opts.row ?? 1,
    idx: opts.idx ?? 0,
    token: opts.token ?? 1,
  }
}

describe('DashboardUndoToast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('renders nothing when trashed=null', async () => {
    mount(DashboardUndoToast, { props: { trashed: null }, attachTo: document.body })
    await nextTick()
    expect(document.querySelector('[data-undo-toast]')).toBeNull()
  })

  it('renders the toast with the widget eyebrow when trashed is provided', async () => {
    mount(DashboardUndoToast, {
      props: { trashed: trashed({ eyebrow: 'Total time played' }) },
      attachTo: document.body,
    })
    await nextTick()
    const toast = document.querySelector('[data-undo-toast]')
    expect(toast).not.toBeNull()
    expect(toast!.querySelector('.dashboard-undo-toast-name')!.textContent).toContain('Total time played')
  })

  it('emits undo when Undo button is clicked', async () => {
    const w = mount(DashboardUndoToast, {
      props: { trashed: trashed({ token: 42 }) },
      attachTo: document.body,
    })
    await nextTick()
    const action = document.querySelector('[data-undo-action]') as HTMLButtonElement
    action.click()
    await nextTick()
    expect(w.emitted('undo')).toBeTruthy()
    expect(w.emitted('undo')![0]).toEqual([42])
  })

  it('emits dismiss when the × button is clicked', async () => {
    const w = mount(DashboardUndoToast, {
      props: { trashed: trashed({ token: 7 }) },
      attachTo: document.body,
    })
    await nextTick()
    const dismiss = document.querySelector('[data-undo-dismiss]') as HTMLButtonElement
    dismiss.click()
    await nextTick()
    expect(w.emitted('dismiss')).toBeTruthy()
    expect(w.emitted('dismiss')![0]).toEqual([7])
  })

  it('auto-emits dismiss after the 6-second window expires', async () => {
    const w = mount(DashboardUndoToast, {
      props: { trashed: trashed({ token: 1 }) },
      attachTo: document.body,
    })
    await nextTick()
    vi.advanceTimersByTime(6500)
    await nextTick()
    expect(w.emitted('dismiss')).toBeTruthy()
  })
})
