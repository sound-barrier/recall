import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref, type Ref } from 'vue'

import { useParseRecovery, type ParseConnectionState } from '@/composables/useParseRecovery'

// Capture the status callback the composable registers so tests can
// drive 'reconnecting' / 'connected' transitions directly.
let capturedStatus: ((s: 'connected' | 'reconnecting') => void) | null = null
vi.mock('@/api', () => ({
  setEventStreamStatusHandler: (cb: ((s: 'connected' | 'reconnecting') => void) | null) => {
    capturedStatus = cb
  },
}))

interface Active { running: boolean; done: number; total: number; scope: string }

function harness(opts: { active: Active; parseBusy?: boolean; staleMs?: number }) {
  const parseBusy = ref(opts.parseBusy ?? false)
  const parseProgress = ref<{ done: number; total: number; filename: string } | null>(null)
  const reload = vi.fn(async () => {})
  const getActiveParse = vi.fn(async () => opts.active)
  let state!: Ref<ParseConnectionState>
  let refresh!: () => void
  const Harness = defineComponent({
    setup() {
      const r = useParseRecovery({
        parseBusy,
        parseProgress: parseProgress as never,
        reload,
        getActiveParse,
        staleMs: opts.staleMs ?? 30,
      })
      state = r.connectionState
      refresh = r.refresh
      return () => null
    },
  })
  const wrapper = mount(Harness)
  return { wrapper, parseBusy, parseProgress, reload, getActiveParse, state: () => state.value, refresh }
}

beforeEach(() => { capturedStatus = null })

describe('useParseRecovery', () => {
  it('resyncs on mount: a server-side running parse restores the panel', async () => {
    const h = harness({ active: { running: true, done: 5, total: 12, scope: 'new' } })
    await flushPromises()
    expect(h.getActiveParse).toHaveBeenCalled()
    expect(h.parseBusy.value).toBe(true)
    expect(h.parseProgress.value).toMatchObject({ done: 5, total: 12 })
    expect(h.state()).toBe('connected')
  })

  it('idle mount does not flip parseBusy or reload', async () => {
    const h = harness({ active: { running: false, done: 0, total: 0, scope: '' }, parseBusy: false })
    await flushPromises()
    expect(h.parseBusy.value).toBe(false)
    expect(h.reload).not.toHaveBeenCalled()
  })

  it('SSE drop during a parse shows reconnecting, reconnect resyncs', async () => {
    const h = harness({ active: { running: true, done: 3, total: 10, scope: 'new' }, parseBusy: true })
    await flushPromises()
    capturedStatus!('reconnecting')
    expect(h.state()).toBe('reconnecting')
    capturedStatus!('connected')
    await flushPromises()
    expect(h.state()).toBe('connected')
    // resync ran a second time on reconnect.
    expect(h.getActiveParse.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('a persistent reconnecting escalates to lost after staleMs', async () => {
    const h = harness({ active: { running: true, done: 1, total: 9, scope: 'new' }, parseBusy: true, staleMs: 20 })
    await flushPromises()
    capturedStatus!('reconnecting')
    expect(h.state()).toBe('reconnecting')
    await new Promise((r) => setTimeout(r, 40))
    expect(h.state()).toBe('lost')
  })

  it('a fresh parse-progress tick clears the reconnecting state', async () => {
    const h = harness({ active: { running: true, done: 1, total: 9, scope: 'new' }, parseBusy: true })
    await flushPromises()
    capturedStatus!('reconnecting')
    expect(h.state()).toBe('reconnecting')
    h.parseProgress.value = { done: 2, total: 9, filename: 'b.png' }
    await flushPromises()
    expect(h.state()).toBe('connected')
  })

  it('reconnecting is ignored when no parse is busy', async () => {
    const h = harness({ active: { running: false, done: 0, total: 0, scope: '' }, parseBusy: false })
    await flushPromises()
    capturedStatus!('reconnecting')
    expect(h.state()).toBe('connected')
  })

  it('refresh re-pulls run-state; a missed completion clears the panel', async () => {
    // parseBusy stuck true but the server says idle → reload + clear.
    const h = harness({ active: { running: false, done: 0, total: 0, scope: '' }, parseBusy: true })
    await flushPromises() // mount resync already heals this case
    expect(h.parseBusy.value).toBe(false)
    expect(h.reload).toHaveBeenCalled()
    h.refresh()
    await flushPromises()
    expect(h.state()).toBe('connected')
  })
})
