import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import type { MatchRecord, TesseractStatus } from '@/api'
import { setApiBacking } from '@/api-client'
import { useParseRunLifecycle } from '@/composables/ingest/useParseRunLifecycle'
import { profileScopedKey } from '@/composables/profile/profileStorage'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'

// This happy-dom version ships no window.localStorage, and the composable
// guards every read/write in a try/catch — without a stand-in the
// last-run-stamp assertions below would be silently vacuous.
const memStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem:    (k: string) => memStore.get(k) ?? null,
  setItem:    (k: string, v: string) => { memStore.set(k, String(v)) },
  removeItem: (k: string) => { memStore.delete(k) },
  clear:      () => { memStore.clear() },
  key:        (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size },
})

// The parse run is a small state machine driven from two directions: the
// user (Parse / Stop / Re-parse all) and the server event stream
// (parse-complete / parse-canceled). Its invariants are the ones that
// strand the UI when they break — a run that never releases parseBusy
// leaves the Parse button dead until reload, and a Stop that never clears
// cancelingParse leaves the status bar stuck on "canceling". These tests
// drive the transitions in the order the app hits them.

const LAST_PARSED_KEY = profileScopedKey('lastParsedAt')
const LEGACY_LAST_PARSED_KEY = 'recall.lastParsedAt'

function tess(over: Partial<TesseractStatus> = {}): TesseractStatus {
  return {
    path: '/usr/bin/tesseract', found: true, version: '5.5.0', supported: true,
    error: '', default: '/usr/bin/tesseract', platform: 'linux', ...over,
  }
}

// A record placed `minutesAgo` in the past via the naive local
// date + finished_at pair matchTime() reads.
function rec(key: string, minutesAgo: number, result: 'victory' | 'defeat'): MatchRecord {
  const d = new Date(Date.now() - minutesAgo * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    match_key: key,
    source_files: [],
    data: {
      map: 'rialto',
      result,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      finished_at: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    },
  }
}

const api = {
  ParseScreenshots: vi.fn(async () => undefined),
  ReParseAll:       vi.fn(async () => undefined),
  CancelParse:      vi.fn(async () => undefined),
  GetTesseractStatus: vi.fn(async () => tess()),
  GetScreenshotsDir:  vi.fn(async () => '/srv/recall'),
  GetWatchEnabled:    vi.fn(async () => true),
  GetExitOnClose:     vi.fn(async () => false),
  GetVersion:         vi.fn(async () => 'dev'),
  GetStartupError:    vi.fn(async () => ''),
}

// Boot the settings store against a seeded Tesseract probe. The cache is
// seeded BEFORE the store exists so its observer never fires the fetch
// that would clobber the seed.
function bootSettings(status: TesseractStatus) {
  seedQuery(qk.settings.tesseract, status)
  return useSettingsStore()
}

function newRun(load: () => Promise<void> = vi.fn(async () => {})) {
  return useParseRunLifecycle({ load })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  setApiBacking(api)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('starting a run', () => {
  it('blocks the run and points at Settings → Engine when Tesseract is missing', async () => {
    bootSettings(tess({ found: false, supported: false }))
    const run = newRun()

    await run.parse()

    expect(api.ParseScreenshots).not.toHaveBeenCalled()
    expect(run.parseBusy.value).toBe(false)
    expect(useAppStore().error).toContain('Settings → Engine')
  })

  it('requires explicit confirmation on an untested Tesseract version, then runs', async () => {
    bootSettings(tess({ supported: false }))
    const run = newRun()

    await run.parse()
    expect(run.showUnsupportedModal.value).toBe(true)
    expect(api.ParseScreenshots).not.toHaveBeenCalled()

    await run.confirmUnsupportedParse()
    expect(run.showUnsupportedModal.value).toBe(false)
    expect(api.ParseScreenshots).toHaveBeenCalledOnce()
    expect(run.parseBusy.value).toBe(true)
  })

  it('clears the previous run’s progress + log and stays busy after the POST resolves', async () => {
    bootSettings(tess())
    const run = newRun()
    run.parseLog.value = [{ done: 1, total: 1, filename: 'old.png', screenshot_type: 'summary' }]
    run.parseProgressOpen.value = true
    useAppStore().setError('a stale banner')

    await run.parse()

    expect(api.ParseScreenshots).toHaveBeenCalledOnce()
    expect(run.parseLog.value).toEqual([])
    expect(run.parseProgress.value).toBeNull()
    expect(run.parseProgressOpen.value).toBe(false)
    expect(useAppStore().error).toBe('')
    // Completion rides the parse-complete event, NOT the POST resolving —
    // otherwise a mid-parse stream drop would flip the panel to "done"
    // while OCR is still running.
    expect(run.parseBusy.value).toBe(true)
  })

  it('releases the busy flag and surfaces plain-language copy when the POST fails', async () => {
    bootSettings(tess())
    api.ParseScreenshots.mockRejectedValueOnce(new Error('write /db: no space left on device'))
    const run = newRun()

    await run.parse()

    expect(run.parseBusy.value).toBe(false)
    expect(run.cancelingParse.value).toBe(false)
    expect(useAppStore().error).toContain('disk is full')
  })
})

describe('re-parse all', () => {
  it('is gated on Tesseract like a normal run', async () => {
    bootSettings(tess({ found: false }))
    const run = newRun()

    await run.onReParseAll()

    expect(api.ReParseAll).not.toHaveBeenCalled()
    expect(useAppStore().error).toContain('Settings → Engine')
  })

  it('releases the busy flag when the re-parse POST fails', async () => {
    bootSettings(tess())
    api.ReParseAll.mockRejectedValueOnce(new Error('stat /shots: permission denied'))
    const run = newRun()

    await run.onReParseAll()

    expect(run.parseBusy.value).toBe(false)
    expect(run.parseProgress.value).toBeNull()
    expect(useAppStore().error).toContain('Cannot access that location')
  })

  it('skips the unsupported-version confirmation — the user already committed', async () => {
    bootSettings(tess({ supported: false }))
    const run = newRun()

    await run.onReParseAll()

    expect(run.showUnsupportedModal.value).toBe(false)
    expect(api.ReParseAll).toHaveBeenCalledOnce()
    expect(run.parseBusy.value).toBe(true)
  })
})

describe('stopping a run', () => {
  it('flips to canceling on the first Stop and ignores repeat clicks', async () => {
    bootSettings(tess())
    const run = newRun()

    await run.onCancelParse()
    await run.onCancelParse()

    expect(run.cancelingParse.value).toBe(true)
    expect(api.CancelParse).toHaveBeenCalledOnce()
  })

  it('re-arms the Stop button when the parse finished before the cancel landed (409)', async () => {
    bootSettings(tess())
    api.CancelParse.mockRejectedValueOnce(new Error('HTTP 409: no parse running'))
    const run = newRun()

    await run.onCancelParse()

    expect(run.cancelingParse.value).toBe(false)
  })
})

describe('terminal transitions', () => {
  // finishParseRun reads the refetched batch straight from the cache, so
  // the fake load() is what a real refetch would have landed there.
  function loadWith(records: MatchRecord[]) {
    return vi.fn(async () => { getQueryClient().setQueryData(qk.matches, records) })
  }

  it('completes: reloads, stamps the last-run time, and announces the fresh count', async () => {
    bootSettings(tess())
    const load = loadWith([rec('m-1', 5, 'victory'), rec('m-2', 3, 'defeat')])
    const run = newRun(load)
    run.parseBusy.value = true

    await run.finishParseRun('complete')

    expect(load).toHaveBeenCalledOnce()
    expect(run.parseBusy.value).toBe(false)
    expect(run.parseProgress.value).toBeNull()
    expect(run.parseAnnouncement.value).toBe('Parse complete. 2 matches loaded.')
    expect(run.lastParsedAt.value).toBeTypeOf('number')
    expect(localStorage.getItem(LAST_PARSED_KEY)).toBe(String(run.lastParsedAt.value))
  })

  it('completes with exactly one match without pluralizing', async () => {
    bootSettings(tess())
    const run = newRun(loadWith([rec('m-1', 5, 'victory')]))

    await run.finishParseRun('complete')

    expect(run.parseAnnouncement.value).toBe('Parse complete. 1 match loaded.')
  })

  it('completes on an empty database without inventing a session', async () => {
    bootSettings(tess())
    // Nothing landed in the cache — a first run over a folder with no
    // readable screenshots. The announcement still has to be spoken.
    const run = newRun(vi.fn(async () => {}))

    await run.finishParseRun('complete')

    expect(run.parseAnnouncement.value).toBe('Parse complete. 0 matches loaded.')
    expect(run.sessionToast.value).toBeNull()
  })

  it('cancels: announces the abort and leaves the last-run stamp untouched', async () => {
    bootSettings(tess())
    const run = newRun(loadWith([rec('m-1', 5, 'victory')]))
    run.parseBusy.value = true

    await run.finishParseRun('canceled')

    expect(run.parseAnnouncement.value).toBe('Parse canceled.')
    expect(run.parseBusy.value).toBe(false)
    expect(run.lastParsedAt.value).toBeNull()
    expect(localStorage.getItem(LAST_PARSED_KEY)).toBeNull()
    expect(run.sessionToast.value).toBeNull()
  })

  it('clears "canceling" when the run completes before the Stop lands (out-of-order)', async () => {
    bootSettings(tess())
    const run = newRun(loadWith([rec('m-1', 5, 'victory')]))
    // User hit Stop; the OCR loop had already reached the last file, so
    // parse-complete arrives instead of parse-canceled.
    await run.onCancelParse()
    expect(run.cancelingParse.value).toBe(true)

    await run.finishParseRun('complete')

    expect(run.cancelingParse.value).toBe(false)
  })

  it('raises the session toast only when the fresh batch is still an ACTIVE session', async () => {
    bootSettings(tess())
    const active = newRun(loadWith([rec('m-1', 40, 'victory'), rec('m-2', 10, 'defeat')]))
    await active.finishParseRun('complete')
    expect(active.sessionToast.value).toMatchObject({ matches: 2, w: 1, l: 1, d: 0 })

    // A batch whose newest match is a day old is history, not "tonight".
    const stale = newRun(loadWith([rec('m-9', 60 * 26, 'victory')]))
    await stale.finishParseRun('complete')
    expect(stale.sessionToast.value).toBeNull()
  })

  it('dismisses the session toast only for the run that raised it', async () => {
    bootSettings(tess())
    const run = newRun(loadWith([rec('m-1', 10, 'victory')]))
    await run.finishParseRun('complete')
    const token = run.sessionToast.value?.token ?? 0

    // A stale timer from an earlier run must not kill this toast.
    run.dismissSessionToast(token - 1)
    expect(run.sessionToast.value).not.toBeNull()

    run.dismissSessionToast(token)
    expect(run.sessionToast.value).toBeNull()
  })
})

describe('screen-reader announcements', () => {
  it('expires its own message after 2s without clobbering a newer one', () => {
    vi.useFakeTimers()
    bootSettings(tess())
    const run = newRun()

    run.announceParse('Parse complete. 1 match loaded.')
    vi.advanceTimersByTime(1000)
    run.announceParse('Parse canceled.')

    // The first message's timer fires here — it must leave the newer
    // announcement alone or the abort is never spoken.
    vi.advanceTimersByTime(1200)
    expect(run.parseAnnouncement.value).toBe('Parse canceled.')

    vi.advanceTimersByTime(1000)
    expect(run.parseAnnouncement.value).toBe('')
  })
})

describe('last-run timestamp hydration', () => {
  it('prefers the profile-scoped stamp over the pre-scoping global one', () => {
    localStorage.setItem(LEGACY_LAST_PARSED_KEY, '1000')
    localStorage.setItem(LAST_PARSED_KEY, '2000')
    const run = newRun()

    run.restoreLastParsedAt()

    expect(run.lastParsedAt.value).toBe(2000)
  })

  it('adopts the global stamp when this profile has none (upgrading install)', () => {
    localStorage.setItem(LEGACY_LAST_PARSED_KEY, '1000')
    const run = newRun()

    run.restoreLastParsedAt()

    expect(run.lastParsedAt.value).toBe(1000)
  })

  it('treats an unreadable stamp as "never parsed"', () => {
    localStorage.setItem(LAST_PARSED_KEY, 'not-a-number')
    const run = newRun()

    run.restoreLastParsedAt()

    expect(run.lastParsedAt.value).toBeNull()
  })
})

describe('parse-stream recovery bridge', () => {
  it('reads connected and no-ops before App wires the recovery machinery', () => {
    const run = newRun()

    expect(run.parseConnectionState.value).toBe('connected')
    expect(() => { run.refreshParse() }).not.toThrow()
  })

  it('chains straight to the wired bridge in both directions', () => {
    const run = newRun()
    const connectionState = ref<'connected' | 'reconnecting'>('connected')
    const refresh = vi.fn()

    run.wireParseRecovery({ connectionState, refresh })
    connectionState.value = 'reconnecting'
    expect(run.parseConnectionState.value).toBe('reconnecting')

    run.refreshParse()
    expect(refresh).toHaveBeenCalledOnce()
  })
})
