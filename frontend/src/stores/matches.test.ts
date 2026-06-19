import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useMatchesStore } from '@/stores/matches'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import type { MatchRecord, TesseractStatus, DataLocation } from '@/api'

// Direct unit tests for the load() boot coordinator — the Promise.allSettled
// fan-out that used to live in App.vue's onMounted and was only reachable through
// a full-App mount. EventsOn/Off + GetActiveParse are no-op'd so creating the
// store (which wires the SSE event-stream + parse-recovery) doesn't reach for the
// absent Wails runtime; the six load() endpoints are mockable per test.
const api = vi.hoisted(() => ({
  GetMatchResults:       vi.fn(),
  GetScreenshotsDir:     vi.fn(),
  GetWatchEnabled:       vi.fn(),
  GetTesseractStatus:    vi.fn(),
  GetNewScreenshotCount: vi.fn(),
  GetDataLocation:       vi.fn(),
}))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  ...api,
  EventsOn:       vi.fn(),
  EventsOff:      vi.fn(),
  GetActiveParse: vi.fn(async () => null),
  // The dossier's useOWData session-singleton lazy-fetches reference data at
  // store setup; resolve it so the test doesn't attempt a real localhost fetch.
  GetOWData:      vi.fn(async () => ({ heroes: [], maps: [], roles: {}, gameModes: [] })),
}))

function tess(over: Partial<TesseractStatus> = {}): TesseractStatus {
  return { path: '/usr/bin/tesseract', found: true, version: '5.5.0', supported: true, error: '', default: '/usr/bin/tesseract', platform: 'darwin', ...over }
}
function rec(key: string): MatchRecord {
  return { match_key: key, source_files: [], data: { map: 'rialto', date: '2026-05-10' } }
}
const DATA_LOC = {
  base_dir: '/data', settings_path: '/data/settings.json',
  database_path: '/data/db/recall.db', screenshots_dir: '/srv/recall',
} as DataLocation

function setHappyDefaults() {
  api.GetMatchResults.mockResolvedValue([rec('m-1'), rec('m-2')])
  api.GetScreenshotsDir.mockResolvedValue('/srv/recall')
  api.GetWatchEnabled.mockResolvedValue(true)
  api.GetTesseractStatus.mockResolvedValue(tess())
  api.GetNewScreenshotCount.mockResolvedValue(3)
  api.GetDataLocation.mockResolvedValue(DATA_LOC)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  setHappyDefaults()
})

describe('matches store — load() boot coordinator', () => {
  it('fans the six endpoints into the app/matches/settings stores on the happy path', async () => {
    const matches = useMatchesStore()
    const settings = useSettingsStore()
    const app = useAppStore()
    expect(matches.firstLoadPending).toBe(true)

    await matches.load()

    expect(matches.records.map(r => r.match_key)).toEqual(['m-1', 'm-2'])
    expect(settings.screenshotsDir).toBe('/srv/recall')
    expect(settings.watchEnabled).toBe(true)
    expect(settings.tesseractReady).toBe(true)
    expect(matches.newScreenshotCount).toBe(3)
    expect(app.dataLocation).toEqual(DATA_LOC)
    expect(matches.firstLoadPending).toBe(false)
  })

  it('isolates a GetMatchResults failure: records stay, the OTHER subsystems still load, Retry is wired', async () => {
    api.GetMatchResults.mockRejectedValue(new Error('database is locked'))
    const matches = useMatchesStore()
    const settings = useSettingsStore()
    const app = useAppStore()

    await matches.load()

    // The records ref is NOT blanked by the failure...
    expect(matches.records).toEqual([])
    // ...and the independent subsystems still applied (per-subsystem isolation).
    expect(settings.screenshotsDir).toBe('/srv/recall')
    expect(settings.tesseractReady).toBe(true)
    expect(matches.newScreenshotCount).toBe(3)
    // The error banner is armed with a Retry.
    expect(app.error).toContain('Could not load matches')
    expect(app.errorRetry).toBeTypeOf('function')
  })

  it('clears its own prior error once a later load() succeeds (errorRetry===load path)', async () => {
    api.GetMatchResults.mockRejectedValueOnce(new Error('database is locked'))
    const matches = useMatchesStore()
    const app = useAppStore()

    await matches.load()
    expect(app.error).toContain('Could not load matches')

    await matches.load() // GetMatchResults now resolves (happy default)
    expect(app.error).toBe('')
    expect(app.errorRetry).toBeNull()
  })

  it('does NOT clobber a working Tesseract probe — a probe failure flips found:false without blanking matches', async () => {
    api.GetTesseractStatus.mockRejectedValue(new Error('exec: "tesseract": not found'))
    const matches = useMatchesStore()
    const settings = useSettingsStore()

    await matches.load()

    // Probe failure → found:false (NOT a false "detected"), and matches still loaded.
    expect(settings.tesseractReady).toBe(false)
    expect(matches.records).toHaveLength(2)
  })

  it('stashes the fetched records into savedRecords while the tour is active (keeps demo data showing)', async () => {
    const matches = useMatchesStore()
    await matches.onTourActiveChange(true) // swaps in DEMO_MATCHES + flags tourActive
    const demoCount = matches.records.length
    expect(demoCount).toBeGreaterThan(0)

    await matches.load()

    // Demo data still on screen; the real fetch parked in savedRecords for restore.
    expect(matches.records).toHaveLength(demoCount)
    expect(matches.savedRecords.map(r => r.match_key)).toEqual(['m-1', 'm-2'])
  })
})
