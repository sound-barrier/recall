import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { render } from '@testing-library/vue'

// Mock the api module so the composable's EventsOn/Off calls land in
// our capture map without touching real Wails / fetch transports.
const handlers: Record<string, (data: unknown) => void> = {}
let onCalls: Array<{ name: string }> = []
let offCalls: Array<{ name: string }> = []

vi.mock('@/api', () => ({
  EventsOn: <T,>(name: string, cb: (data: T) => void) => {
    handlers[name] = cb as (data: unknown) => void
    onCalls.push({ name })
  },
  EventsOff: (name: string) => {
    delete handlers[name]
    offCalls.push({ name })
  },
}))

import type { MatchRecord } from '@/api'
import { useEventStream } from '@/composables/shared/useEventStream'
import type { ParseProgressEvent } from '@/components/ingest/parse-progress'

function rec(matchKey: string, extra?: Partial<MatchRecord>): MatchRecord {
  return {
    match_key: matchKey,
    source_files: [],
    data: {},
    ...extra,
  }
}

function progress(filename: string, done: number, total: number): ParseProgressEvent {
  return { run_id: 1, filename, done, total, screenshot_type: 'summary' }
}

function streamApi(over: Partial<Parameters<typeof useEventStream>[0]> = {}) {
  return {
    records: ref<MatchRecord[]>([]),
    onParseProgress: vi.fn(),
    onRunFinished: vi.fn(),
    ...over,
  }
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
  const view = render(Comp)
  return { view, result }
}

describe('useEventStream', () => {
  beforeEach(() => {
    Object.keys(handlers).forEach(k => delete handlers[k])
    onCalls = []
    offCalls = []
  })

  afterEach(() => { vi.clearAllMocks() })

  const EVENTS = [
    'coach-session-changed',
    'match-updated',
    'parse-progress',
    'run-finished',
    'tesseract-status',
    'watch-activity',
  ]

  it('subscribes to every event on mount', () => {
    mountComposable(streamApi())
    expect(onCalls.map(c => c.name).sort()).toEqual(EVENTS)
  })

  it('unsubscribes from every event on unmount', () => {
    const { view } = mountComposable(streamApi())
    view.unmount()
    expect(offCalls.map(c => c.name).sort()).toEqual(EVENTS)
  })

  it('tesseract-status forwards the published status to onTesseractStatus', () => {
    const onTesseractStatus = vi.fn()
    mountComposable(streamApi({ onTesseractStatus }))
    const status = { path: '/usr/bin/tesseract', found: true, version: '5.3.0', supported: true, error: '', default: '', platform: 'linux' }
    handlers['tesseract-status']!(status)
    expect(onTesseractStatus).toHaveBeenCalledWith(status)
  })

  // Two windows on one install share a session: the one that did not open
  // it must still lock its writes, or it will try to edit the coach's own
  // matches while the corpus on screen belongs to someone else.
  it('coach-session-changed forwards the active flag to onCoachSessionChanged', () => {
    const onCoachSessionChanged = vi.fn()
    mountComposable(streamApi({ onCoachSessionChanged }))
    handlers['coach-session-changed']!({ active: true })
    expect(onCoachSessionChanged).toHaveBeenCalledWith(true)
    handlers['coach-session-changed']!({ active: false })
    expect(onCoachSessionChanged).toHaveBeenLastCalledWith(false)
  })

  it('parse-progress hands each tick to onParseProgress', () => {
    const api = streamApi()
    mountComposable(api)
    const ev = progress('a.png', 1, 3)
    handlers['parse-progress']!(ev)
    expect(api.onParseProgress).toHaveBeenCalledWith(ev)
  })

  it('run-finished hands the run\'s end to onRunFinished', () => {
    const api = streamApi()
    mountComposable(api)
    const ev = { run_id: 1, kind: 'parse', outcome: 'failed', error: 'disk full' }
    handlers['run-finished']!(ev)
    expect(api.onRunFinished).toHaveBeenCalledWith(ev)
  })

  it('a null payload reaches neither run handler', () => {
    const api = streamApi()
    mountComposable(api)
    handlers['parse-progress']!(null)
    handlers['run-finished']!(null)
    expect(api.onParseProgress).not.toHaveBeenCalled()
    expect(api.onRunFinished).not.toHaveBeenCalled()
  })

  it('match-updated inserts a new record at the end', () => {
    const records = ref<MatchRecord[]>([rec('k1')])
    mountComposable(streamApi({ records }))
    handlers['match-updated']!(rec('k2'))
    expect(records.value.map(r => r.match_key)).toEqual(['k1', 'k2'])
  })

  it('match-updated upserts an existing record by match_key (in place)', () => {
    const records = ref<MatchRecord[]>([rec('k1'), rec('k2', { data: { map: 'rialto' } })])
    mountComposable(streamApi({ records }))
    handlers['match-updated']!(rec('k2', { data: { map: 'ilios' } }))
    expect(records.value.map(r => r.match_key)).toEqual(['k1', 'k2'])
    expect(records.value[1]!.data?.map).toBe('ilios')
  })

  it('match-updated ignores null and empty match_key', () => {
    const records = ref<MatchRecord[]>([rec('k1')])
    mountComposable(streamApi({ records }))
    handlers['match-updated']!(null)
    handlers['match-updated']!(rec(''))
    expect(records.value.length).toBe(1)
  })
})
