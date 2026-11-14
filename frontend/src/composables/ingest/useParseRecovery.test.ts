import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/vue'
import { flushPromises } from '@/test-utils'
import { defineComponent, ref, type Ref } from 'vue'

import type { ActiveRun } from '@/api-client'
import type { ParseProgressEvent } from '@/components/ingest/parse-progress'
import { useParseRecovery, type ParseConnectionState } from '@/composables/ingest/useParseRecovery'

// Capture the status callback the composable registers so tests can
// drive 'reconnecting' / 'connected' transitions directly.
let capturedStatus: ((s: 'connected' | 'reconnecting') => void) | null = null
vi.mock('@/api', () => ({
  setEventStreamStatusHandler: (cb: ((s: 'connected' | 'reconnecting') => void) | null) => {
    capturedStatus = cb
  },
}))

const running: ActiveRun = { state: 'running', run_id: 4, kind: 'parse', done: 5, total: 12 }
const idle: ActiveRun = { state: 'idle' }

function harness(opts: { active: ActiveRun | (() => Promise<ActiveRun>); parseBusy?: boolean; staleMs?: number; generation?: number }) {
  const parseBusy = ref(opts.parseBusy ?? false)
  const parseProgress = ref<ParseProgressEvent | null>(null)
  const reload = vi.fn(async () => {})
  const source = opts.active
  const getActiveParse = vi.fn(typeof source === 'function' ? source : async () => source)
  const applySnapshot = vi.fn()
  let state!: Ref<ParseConnectionState>
  let refresh!: () => Promise<void>
  const Harness = defineComponent({
    setup() {
      const r = useParseRecovery({
        parseBusy,
        parseProgress,
        reload,
        getActiveParse,
        runGeneration: () => opts.generation ?? 7,
        applySnapshot,
        staleMs: opts.staleMs ?? 30,
      })
      state = r.connectionState
      refresh = r.refresh
      return () => null
    },
  })
  render(Harness)
  return { parseBusy, parseProgress, reload, getActiveParse, applySnapshot, state: () => state.value, refresh: () => refresh() }
}

beforeEach(() => { capturedStatus = null })

describe('useParseRecovery', () => {
  it('resyncs on mount, handing the snapshot back with the generation it was read at', async () => {
    const h = harness({ active: running, generation: 3 })
    await flushPromises()
    expect(h.applySnapshot).toHaveBeenCalledWith(running, 3)
    expect(h.state()).toBe('connected')
  })

  it('reads the generation BEFORE the request, so a run that moves meanwhile makes the snapshot stale', async () => {
    let generation = 3
    let answer!: (a: ActiveRun) => void
    const parseBusy = ref(false)
    const applySnapshot = vi.fn()
    const Harness = defineComponent({
      setup() {
        useParseRecovery({
          parseBusy,
          parseProgress: ref(null),
          reload: vi.fn(),
          getActiveParse: () => new Promise<ActiveRun>((r) => { answer = r }),
          runGeneration: () => generation,
          applySnapshot,
        })
        return () => null
      },
    })
    render(Harness)
    generation = 4
    answer(running)
    await flushPromises()
    expect(applySnapshot).toHaveBeenCalledWith(running, 3)
  })

  it('an SSE drop shows reconnecting; the reconnect resyncs and reloads the matches', async () => {
    const h = harness({ active: running, parseBusy: true })
    await flushPromises()
    capturedStatus!('reconnecting')
    expect(h.state()).toBe('reconnecting')
    capturedStatus!('connected')
    await flushPromises()
    expect(h.state()).toBe('connected')
    expect(h.getActiveParse).toHaveBeenCalledTimes(2)
    expect(h.reload).toHaveBeenCalledOnce()
  })

  // The folder watcher runs while nobody is looking: a drop while idle can
  // swallow a whole run's match-updated events, so the reconnect reconciles
  // whether or not anything looked busy.
  it('reconciles on a reconnect while idle too', async () => {
    const h = harness({ active: idle, parseBusy: false })
    await flushPromises()
    capturedStatus!('reconnecting')
    capturedStatus!('connected')
    await flushPromises()
    expect(h.getActiveParse).toHaveBeenCalledTimes(2)
    expect(h.reload).toHaveBeenCalledOnce()
  })

  it('a persistent reconnecting escalates to lost after staleMs while a run is busy', async () => {
    const h = harness({ active: running, parseBusy: true, staleMs: 20 })
    await flushPromises()
    capturedStatus!('reconnecting')
    await new Promise((r) => setTimeout(r, 40))
    expect(h.state()).toBe('lost')
  })

  it('never escalates to lost while idle', async () => {
    const h = harness({ active: idle, parseBusy: false, staleMs: 20 })
    await flushPromises()
    capturedStatus!('reconnecting')
    await new Promise((r) => setTimeout(r, 40))
    expect(h.state()).toBe('reconnecting')
  })

  it('a fresh parse-progress tick clears the reconnecting state', async () => {
    const h = harness({ active: running, parseBusy: true })
    await flushPromises()
    capturedStatus!('reconnecting')
    h.parseProgress.value = { run_id: 4, done: 2, total: 9, filename: 'b.png', screenshot_type: '' }
    await flushPromises()
    expect(h.state()).toBe('connected')
  })

  it('refresh reads connected only once the server has answered', async () => {
    let fail = false
    const h = harness({ active: async () => { if (fail) throw new Error('down'); return running }, parseBusy: true, staleMs: 10 })
    await flushPromises()
    capturedStatus!('reconnecting')
    await new Promise((r) => setTimeout(r, 20))
    expect(h.state()).toBe('lost')

    fail = true
    await h.refresh()
    expect(h.state()).toBe('lost')

    fail = false
    await h.refresh()
    expect(h.state()).toBe('connected')
  })
})
