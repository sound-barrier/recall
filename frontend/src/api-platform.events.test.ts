import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Server-mode half of api-platform.ts. IS_WAILS is false under Vitest
// (the serving origin is plain http), so this file exercises the browser
// branches honestly: the ONE shared EventSource that fans every event
// name out to per-name listeners, its connection-status reporting, and
// the client-side CSV download. The Wails branches of the same functions
// (Events.On/Off, the native save dialogs) are unreachable here by
// construction and are pinned in api-platform.wails.test.ts instead.
//
// The bridge holds module-level state (the shared source + its listener
// registry), so each test starts from a fresh module instance.

type Listener = (e: Event) => void

// Stand-in for the browser EventSource: records every instance so a test
// can assert the source is shared (and later closed), and exposes emit()
// to deliver a server-sent frame by name.
class FakeEventSource {
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []

  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(name: string, cb: Listener): void {
    const set = this.listeners.get(name) ?? new Set<Listener>()
    set.add(cb)
    this.listeners.set(name, set)
  }

  removeEventListener(name: string, cb: Listener): void {
    this.listeners.get(name)?.delete(cb)
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED
  }

  emit(name: string, data: string | null): void {
    for (const cb of [...(this.listeners.get(name) ?? [])]) {
      cb(new MessageEvent(name, { data }))
    }
  }
}

function onlySource(): FakeEventSource {
  const [first] = FakeEventSource.instances
  if (!first) throw new Error('no EventSource was opened')
  return first
}

function loadPlatform() {
  return import('@/api-platform')
}

beforeEach(() => {
  vi.resetModules()
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server-mode event bridge — delivery', () => {
  it('opens ONE shared stream for every subscribed event name', async () => {
    const { EventsOn } = await loadPlatform()
    EventsOn('parse-progress', vi.fn())
    EventsOn('parse-complete', vi.fn())
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(onlySource().url).toBe('/api/v1/events')
  })

  it('JSON-decodes a frame and delivers it to that name only', async () => {
    const { EventsOn } = await loadPlatform()
    const onProgress = vi.fn()
    const onComplete = vi.fn()
    EventsOn('parse-progress', onProgress)
    EventsOn('parse-complete', onComplete)

    onlySource().emit('parse-progress', JSON.stringify({ done: 2, total: 5 }))

    expect(onProgress).toHaveBeenCalledWith({ done: 2, total: 5 })
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('survives a malformed frame — delivers null and keeps the subscription live', async () => {
    const { EventsOn } = await loadPlatform()
    const onProgress = vi.fn()
    EventsOn('parse-progress', onProgress)

    // A truncated SSE frame must not throw out of the listener: that
    // would tear down delivery for every later event on the stream.
    onlySource().emit('parse-progress', '{"done":2,')
    onlySource().emit('parse-progress', JSON.stringify({ done: 3, total: 5 }))

    expect(onProgress.mock.calls).toEqual([[null], [{ done: 3, total: 5 }]])
  })

  it('delivers null for a bodiless frame', async () => {
    const { EventsOn } = await loadPlatform()
    const onPing = vi.fn()
    EventsOn('parse-canceled', onPing)

    onlySource().emit('parse-canceled', '')

    expect(onPing).toHaveBeenCalledWith(null)
  })

  it('re-subscribing a name replaces the previous listener (HMR double-mount guard)', async () => {
    const { EventsOn } = await loadPlatform()
    const stale = vi.fn()
    const fresh = vi.fn()
    EventsOn('parse-complete', stale)
    EventsOn('parse-complete', fresh)

    onlySource().emit('parse-complete', JSON.stringify({ count: 1 }))

    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledOnce()
  })
})

describe('server-mode event bridge — teardown', () => {
  it('stops delivery per name, closes the stream on the last unsubscribe, and reopens on demand', async () => {
    const { EventsOn, EventsOff } = await loadPlatform()
    const onProgress = vi.fn()
    const onComplete = vi.fn()
    EventsOn('parse-progress', onProgress)
    EventsOn('parse-complete', onComplete)
    const source = onlySource()

    // Unsubscribing a name nobody registered (a double unmount) must be
    // inert — not close the stream out from under the live listeners.
    EventsOff('watch-activity')
    expect(source.readyState).not.toBe(FakeEventSource.CLOSED)

    EventsOff('parse-progress')
    source.emit('parse-progress', JSON.stringify({ done: 1 }))
    expect(onProgress).not.toHaveBeenCalled()
    // One name still listening — the shared stream must stay open.
    expect(source.readyState).not.toBe(FakeEventSource.CLOSED)

    EventsOff('parse-complete')
    expect(source.readyState).toBe(FakeEventSource.CLOSED)

    // A later subscription can't reuse the closed source.
    EventsOn('parse-progress', onProgress)
    expect(FakeEventSource.instances).toHaveLength(2)
  })
})

describe('server-mode event bridge — connection status', () => {
  it('reports reconnecting on a drop and connected when the stream reopens', async () => {
    const { EventsOn, setEventStreamStatusHandler } = await loadPlatform()
    const onStatus = vi.fn()
    setEventStreamStatusHandler(onStatus)
    EventsOn('parse-progress', vi.fn())
    const source = onlySource()

    source.onopen?.()
    source.onerror?.() // browser is auto-retrying: readyState is not CLOSED
    source.onopen?.()

    expect(onStatus.mock.calls.flat()).toEqual(['connected', 'reconnecting', 'connected'])
  })

  it('stays quiet when the error follows a deliberate close', async () => {
    const { EventsOn, EventsOff, setEventStreamStatusHandler } = await loadPlatform()
    const onStatus = vi.fn()
    setEventStreamStatusHandler(onStatus)
    EventsOn('parse-progress', vi.fn())
    const source = onlySource()

    EventsOff('parse-progress') // closes the shared source
    source.onerror?.()

    // A teardown must not light up the "reconnecting" indicator.
    expect(onStatus).not.toHaveBeenCalled()
  })

  it('detaches the observer when the handler is cleared', async () => {
    const { EventsOn, setEventStreamStatusHandler } = await loadPlatform()
    const onStatus = vi.fn()
    setEventStreamStatusHandler(onStatus)
    EventsOn('parse-progress', vi.fn())
    const source = onlySource()

    setEventStreamStatusHandler(null)
    source.onopen?.()

    expect(onStatus).not.toHaveBeenCalled()
  })
})

describe('ExportMatchesCSV (server mode)', () => {
  it('saves the caller-assembled sheet locally without touching the network', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { ExportMatchesCSV } = await loadPlatform()
    // The CSV is built client-side (matchesToCSV) — routing it through
    // the server would be a pointless round-trip of data the page holds.
    expect(await ExportMatchesCSV('when,result\n2026-05-10,victory', 'matches.csv')).toBe('matches.csv')
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(fetchSpy).not.toHaveBeenCalled()

    clickSpy.mockRestore()
  })
})
