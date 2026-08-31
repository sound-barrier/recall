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

  it('subscribes to all seven lifecycle events on mount', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn() })
    expect(onCalls.map(c => c.name).sort()).toEqual([
      'coach-session-changed',
      'match-updated',
      'parse-canceled',
      'parse-complete',
      'parse-progress',
      'tesseract-status',
      'watch-activity',
    ])
  })

  it('unsubscribes from all seven on unmount', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const { view } = mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn() })
    view.unmount()
    expect(offCalls.map(c => c.name).sort()).toEqual([
      'coach-session-changed',
      'match-updated',
      'parse-canceled',
      'parse-complete',
      'parse-progress',
      'tesseract-status',
      'watch-activity',
    ])
  })

  it('tesseract-status forwards the published status to onTesseractStatus', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const onTesseractStatus = vi.fn()
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn(), onTesseractStatus })
    const status = { path: '/usr/bin/tesseract', found: true, version: '5.3.0', supported: true, error: '', default: '', platform: 'linux' }
    handlers['tesseract-status']!(status)
    expect(onTesseractStatus).toHaveBeenCalledWith(status)
  })

  // Two windows on one install share a session: the one that did not open
  // it must still lock its writes, or it will try to edit the coach's own
  // matches while the corpus on screen belongs to someone else.
  it('coach-session-changed forwards the active flag to onCoachSessionChanged', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const onCoachSessionChanged = vi.fn()
    mountComposable({ records, parseProgress, parseLog, onParseComplete: vi.fn(), onCoachSessionChanged })
    handlers['coach-session-changed']!({ active: true })
    expect(onCoachSessionChanged).toHaveBeenCalledWith(true)
    handlers['coach-session-changed']!({ active: false })
    expect(onCoachSessionChanged).toHaveBeenLastCalledWith(false)
  })

  it('parse-canceled fires the caller-supplied onParseCanceled when provided', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const onParseComplete = vi.fn()
    const onParseCanceled = vi.fn()
    mountComposable({ records, parseProgress, parseLog, onParseComplete, onParseCanceled })
    handlers['parse-canceled']!(null)
    expect(onParseCanceled).toHaveBeenCalled()
    expect(onParseComplete).not.toHaveBeenCalled()
  })

  it('parse-canceled falls back to onParseComplete when no cancel hook supplied', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const onParseComplete = vi.fn()
    mountComposable({ records, parseProgress, parseLog, onParseComplete })
    handlers['parse-canceled']!(null)
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

  // The payload narrowing: a real run summary passes through verbatim;
  // the legacy filler shapes (null above, "{}" here) reach the callback
  // as undefined — truthy-but-empty must not masquerade as a tally.
  it('parse-complete forwards a valid run summary and rejects the {} filler', () => {
    const records = ref<MatchRecord[]>([])
    const parseProgress = ref<ParseProgressEvent | null>(null)
    const parseLog = ref<ParseProgressEvent[]>([])
    const onParseComplete = vi.fn()
    mountComposable({ records, parseProgress, parseLog, onParseComplete })

    const summary = { files_parsed: 4, files_failed: 2, matches_updated: 3 }
    handlers['parse-complete']!(summary)
    expect(onParseComplete).toHaveBeenLastCalledWith(summary)

    handlers['parse-complete']!({})
    expect(onParseComplete).toHaveBeenLastCalledWith(undefined)
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
