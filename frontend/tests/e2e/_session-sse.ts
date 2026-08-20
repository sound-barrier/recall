/**
 * The parse event stream, faked — and local-date stamps to drive it with.
 *
 * Two specs need the same thing: put matches on the wire, tell the app a
 * parse finished, and watch what a LIVE session makes appear. Both the
 * session tally and the focus nudge key off that moment, so the mock that
 * produces it belongs here rather than copied into each.
 */
import { type Page } from '@playwright/test'

type MockListener = (e: MessageEvent) => void

/** Replace EventSource with one a spec can fire by hand. */
export async function installSSEMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const handlers: Record<string, MockListener[]> = {}
    class MockEventSource {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      url: string
      readyState = 1
      onerror: ((e: Event) => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onopen: ((e: Event) => void) | null = null
      constructor(url: string) { this.url = url }
      addEventListener(name: string, fn: MockListener) {
        if (!handlers[name]) handlers[name] = []
        handlers[name].push(fn)
      }
      removeEventListener(name: string, fn: MockListener) {
        const arr = handlers[name]
        if (!arr) return
        const i = arr.indexOf(fn)
        if (i >= 0) arr.splice(i, 1)
      }
      close() { this.readyState = 2 }
      dispatchEvent(_e: Event): boolean { return true }
    }
    ;(window as unknown as { EventSource: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource
    ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE = {
      emit(name: string, data?: unknown) {
        const arr = handlers[name]
        if (!arr) return
        const payload = data === undefined ? '' : JSON.stringify(data)
        for (const fn of arr) fn(new MessageEvent(name, { data: payload }))
      },
    }
  })
}

/** Fire one parse event from the page. */
export function emitParseEvent(page: Page, name = 'parse-complete'): Promise<void> {
  return page.evaluate((n) => {
    ;(window as unknown as { __recallSSE: { emit: (x: string, d?: unknown) => void } }).__recallSSE.emit(n)
  }, name)
}

/**
 * A stamp N minutes ago, in LOCAL components.
 *
 * Never toISOString: a match played at 19:00 local is on tomorrow's UTC
 * date for half the world, and a fixture that says so rolls straight out
 * of the window every session predicate reads.
 */
export function localStamp(minutesAgo: number): { date: string; time: string; key: string } {
  const d = new Date(Date.now() - minutesAgo * 60_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    key: `match-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-00`,
  }
}
