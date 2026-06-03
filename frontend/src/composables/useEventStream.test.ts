import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'

// Mock the api module so the composable's EventsOn/Off calls land in
// our capture map without touching real Wails / fetch transports.
const handlers: Record<string, (data: unknown) => void> = {}
let onCalls: Array<{ name: string }> = []
let offCalls: Array<{ name: string }> = []

vi.mock('../api', () => ({
  EventsOn: <T,>(name: string, cb: (data: T) => void) => {
    handlers[name] = cb as (data: unknown) => void
    onCalls.push({ name })
  },
  EventsOff: (name: string) => {
    delete handlers[name]
    offCalls.push({ name })
  },
}))

import type { MatchRecord } from '../api'
import { useEventStream } from './useEventStream'
import type { ParseProgressEvent } from '../components/ParseProgressPanel.vue'

function rec(matchKey: string, extra?: Partial<MatchRecord>): MatchRecord {
  return {
    match_key: matchKey,
    source_files: [],
    data: {},
    ...extra,
  }
}

function progress(filename: string, done: number, total: number): ParseProgressEvent {
  return { filename, done, total, screenshot_type: 'summary' } as ParseProgressEvent
}

// Mount the composable inside a tiny component so onMounted /
// onBeforeUnmount fire.
function mountComposable(api: Parameters<typeof useEventStream>[0]) {
  let result!: ReturnType<typeof useEventStream>
  const Comp = defineComponent({
    setup() {
      result = useEventStream(api)
      return () => h('div')
    },
  })
  const wrapper = mount(Comp)
  return { wrapper, result }
}

describe('useEventStream', () => {
  beforeEach(() => {
    Object.keys(handlers).forEach(k => delete handlers[k])
    onCalls = []
    offCalls = []
  })

  afterEach(() => { vi.clearAllMocks() })

  it('subscribes to all four lifecycle events on mount', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn() })
    expect(onCalls.map(c => c.name).sort()).toEqual([
      'match-updated',
      'parse-cancelled',
      'parse-complete',
      'parse-progress',
    ])
  })

  it('unsubscribes from all four on unmount', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const { wrapper } = mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn() })
    wrapper.unmount()
    expect(offCalls.map(c => c.name).sort()).toEqual([
      'match-updated',
      'parse-cancelled',
      'parse-complete',
      'parse-progress',
    ])
  })

  it('parse-cancelled fires the caller-supplied onParseCancelled when provided', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const onParseComplete = vi.fn()
    const onParseCancelled = vi.fn()
    mountComposable({ records, parseProgress, parseLog, onParseComplete, onParseCancelled })
    handlers['parse-cancelled']!(null)
    expect(onParseCancelled).toHaveBeenCalled()
    expect(onParseComplete).not.toHaveBeenCalled()
  })

  it('parse-cancelled falls back to onParseComplete when no cancel hook supplied', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const onParseComplete = vi.fn()
    mountComposable({ records, parseProgress, parseLog, onParseComplete })
    handlers['parse-cancelled']!(null)
    expect(onParseComplete).toHaveBeenCalled()
  })

  it('parse-progress writes to parseProgress and appends to parseLog', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn() })
    const ev = progress('a.png', 1, 3)
    handlers['parse-progress']!(ev)
    expect(parseProgress.value).toEqual(ev)
    expect(parseLog.value).toEqual([ev])
  })

  it('parse-progress null payload is ignored', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn() })
    handlers['parse-progress']!(null)
    expect(parseProgress.value).toBeNull()
    expect(parseLog.value).toEqual([])
  })

  it('parseLog is capped at the cap option (default 50)', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn(), logCap: 3 })
    for (let i = 0; i < 5; i++) handlers['parse-progress']!(progress(`f${i}.png`, i, 5))
    expect(parseLog.value.length).toBe(3)
    expect(parseLog.value[0]!.filename).toBe('f2.png') // oldest evicted
    expect(parseLog.value[2]!.filename).toBe('f4.png')
  })

  it('parse-complete fires the caller-supplied callback', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const onParseComplete = vi.fn()
    mountComposable({ records, parseProgress, parseLog, onParseComplete })
    handlers['parse-complete']!(null)
    expect(onParseComplete).toHaveBeenCalled()
  })

  it('match-updated inserts a new record at the end', () => {
    const records = ref<MatchRecord[]>([rec('k1')])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn() })
    handlers['match-updated']!(rec('k2'))
    expect(records.value.map(r => r.match_key)).toEqual(['k1', 'k2'])
  })

  it('match-updated upserts an existing record by match_key (in place)', () => {
    const records = ref<MatchRecord[]>([rec('k1'), rec('k2', { data: { map: 'rialto' } })])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn() })
    handlers['match-updated']!(rec('k2', { data: { map: 'ilios' } }))
    expect(records.value.map(r => r.match_key)).toEqual(['k1', 'k2'])
    expect(records.value[1]!.data?.map).toBe('ilios')
  })

  it('match-updated ignores null and empty match_key', () => {
    const records = ref<MatchRecord[]>([rec('k1')])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn() })
    handlers['match-updated']!(null)
    handlers['match-updated']!(rec(''))
    expect(records.value.length).toBe(1)
  })
})
