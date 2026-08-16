import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useMatchesStore } from '@/stores/matches'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import type { MatchRecord, TesseractStatus, DataLocation } from '@/api'

// Direct unit tests for the boot-time domain loaders useAppBoot fans into —
// matchesStore.load() (records + new-count), settingsStore.load() (dir /
// watch / exit-close / tesseract), and appStore.loadDataLocation(). The
// per-subsystem isolation contract is the point: one failed endpoint never
// blocks the others. EventsOn/Off + GetActiveParse are no-op'd so creating
// the store (which wires the SSE event-stream + parse-recovery) doesn't
// reach for the absent Wails runtime.
const api = vi.hoisted(() => ({
  GetMatchResults:       vi.fn(),
  GetScreenshotsDir:     vi.fn(),
  GetWatchEnabled:       vi.fn(),
  GetTesseractStatus:    vi.fn(),
  GetExitOnClose:        vi.fn(),
  GetNewScreenshotCount: vi.fn(),
  GetDataLocation:       vi.fn(),
  // The store now reads the coaching overlay, which brings the coach
  // store's own observers along; stub their reads so no unit test dials
  // an endpoint it isn't about.
  ListCoachReturns:        vi.fn(),
  GetCoachSessionMatches:  vi.fn(),
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
  api.GetExitOnClose.mockResolvedValue(false)
  api.GetNewScreenshotCount.mockResolvedValue(3)
  api.GetDataLocation.mockResolvedValue(DATA_LOC)
  api.ListCoachReturns.mockResolvedValue([])
  api.GetCoachSessionMatches.mockResolvedValue([rec('loan-1')])
}

const SESSION_VIEW = {
  player: { id: 'sable-id', handle: 'Sable', message: '' },
  exported_at: '2026-08-14T18:30:00Z',
  session_date: '2026-08-15',
  match_count: 1,
  coach_name: 'Ordo',
  summary: '',
  notes: [],
  handle_from_bundle: true,
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  setHappyDefaults()
})

describe('matches store — load() boot coordinator', () => {
  it('the boot fan-out hydrates each store from its OWN loader', async () => {
    const matches = useMatchesStore()
    const settings = useSettingsStore()
    const app = useAppStore()
    expect(matches.firstLoadPending).toBe(true)

    // dataLocation + the settings fields hydrate from their queries at
    // store setup — a macrotask tick lets the observers land the payloads.
    await matches.load()
    await new Promise(r => setTimeout(r, 0))

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
    await new Promise(r => setTimeout(r, 0))

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
    await new Promise(r => setTimeout(r, 0))

    // Probe failure → found:false (NOT a false "detected"), and matches still loaded.
    expect(settings.tesseractReady).toBe(false)
    expect(matches.records).toHaveLength(2)
  })

  // Overlay precedence is session > tour > real. The two overlays are
  // mutually exclusive by construction, so what these pin is both halves
  // of that exclusivity — not a race the ternary has to arbitrate.
  it('hands every view the LOANED corpus while a coaching session is open', async () => {
    seedQuery(qk.coach.session, SESSION_VIEW)
    seedQuery(qk.coach.matches, [rec('loan-1')])
    const matches = useMatchesStore()

    await matches.load()
    await new Promise(r => setTimeout(r, 0))

    expect(matches.records.map(r => r.match_key)).toEqual(['loan-1'])
  })

  it('refuses to open the tour on top of a session — the coach keeps the player\'s data', async () => {
    seedQuery(qk.coach.session, SESSION_VIEW)
    seedQuery(qk.coach.matches, [rec('loan-1')])
    const matches = useMatchesStore()
    await new Promise(r => setTimeout(r, 0))

    await matches.onTourActiveChange(true)

    expect(matches.tourActive).toBe(false)
    expect(matches.records.map(r => r.match_key)).toEqual(['loan-1'])
  })

  it('keeps demo records showing while the tour is active — the real fetch lands in the cache', async () => {
    const matches = useMatchesStore()
    await matches.onTourActiveChange(true) // overlays DEMO_MATCHES + flags tourActive
    const demoCount = matches.records.length
    expect(demoCount).toBeGreaterThan(0)

    await matches.load()
    await new Promise(r => setTimeout(r, 0))

    // Demo data still on screen; the real fetch flowed into the cache and
    // shows the moment the tour closes — no stash/restore step.
    expect(matches.records).toHaveLength(demoCount)
    await matches.onTourActiveChange(false)
    expect(matches.records.map(r => r.match_key)).toEqual(['m-1', 'm-2'])
  })
})
