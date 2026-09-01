import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the GetOWData round-trip so the singleton fetch resolves to
// our fixture. The composable is a module-level singleton, so we
// reset its internal state via `vi.resetModules()` between tests.
const getOWDataMock = vi.fn()

vi.mock('@/api', () => ({
  GetOWData: () => getOWDataMock(),
}))

const SAMPLE_DATA = {
  heroes_by_role: {
    support: ['Lúcio', 'Ana', 'Juno'],
    damage:  ['Soldier: 76', 'Mei'],
    tank:    ['Reinhardt'],
  },
  maps_by_game_mode: {
    control:    ['Antarctic Peninsula', 'Ilios'],
    push:       ['Esperança'],
    hybrid:     ["King's Row"],
    flashpoint: ['New Junk City'],
  },
  screenshot_sources: [],
  seasons: [
    { name: 'Reign of Talon — Season 1', chapter: 'Reign of Talon', number: 1, start: '2026-02-10T19:00:00Z', end: '2026-04-14T19:00:00Z' },
    { name: 'Reign of Talon — Season 2', chapter: 'Reign of Talon', number: 2, start: '2026-04-14T19:00:00Z', end: '2026-06-16T19:00:00Z' },
  ], patches: [],
}

async function freshOWData() {
  // Reset the module so the singleton-fetch flag resets too.
  vi.resetModules()
  const mod = await import('@/composables/shared/useOWData')
  return mod.useOWData
}

describe('useOWData', () => {
  beforeEach(() => {
    getOWDataMock.mockReset()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('first call kicks off the fetch; subsequent calls share the same refs', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const api1 = useOWData()
    const api2 = useOWData()
    expect(getOWDataMock).toHaveBeenCalledTimes(1)
    expect(api1.data).toBe(api2.data)
  })

  it('heroDisplayName returns the input lowercase form until fetch resolves', async () => {
    let resolve: (v: typeof SAMPLE_DATA) => void = () => {}
    getOWDataMock.mockReturnValue(new Promise(r => { resolve = r }))
    const useOWData = await freshOWData()
    const api = useOWData()
    // Before fetch resolves, the input passes through unchanged
    // (graceful degrade contract).
    expect(api.heroDisplayName('lucio')).toBe('lucio')
    resolve(SAMPLE_DATA)
    await new Promise(r => setTimeout(r, 0))
    expect(api.heroDisplayName('lucio')).toBe('Lúcio')
  })

  it('heroDisplayName resolves diacritic-stripped lowercase form to canonical', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const api = useOWData()
    await new Promise(r => setTimeout(r, 0))
    expect(api.heroDisplayName('lucio')).toBe('Lúcio')
  })

  it('mapDisplayName resolves colon + diacritic + space variants', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const api = useOWData()
    await new Promise(r => setTimeout(r, 0))
    expect(api.mapDisplayName("king's row")).toBe("King's Row")
    expect(api.mapDisplayName('esperanca')).toBe('Esperança')
  })

  it('heroDisplayName "soldier 76" resolves through colon normalization', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const api = useOWData()
    await new Promise(r => setTimeout(r, 0))
    expect(api.heroDisplayName('soldier 76')).toBe('Soldier: 76')
  })

  it('heroRole resolves from a hero name', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const api = useOWData()
    await new Promise(r => setTimeout(r, 0))
    expect(api.heroRole('lucio')).toBe('support')
    expect(api.heroRole('mei')).toBe('damage')
    expect(api.heroRole('reinhardt')).toBe('tank')
  })

  it('mapGameMode resolves from a map name', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const api = useOWData()
    await new Promise(r => setTimeout(r, 0))
    expect(api.mapGameMode('ilios')).toBe('control')
    expect(api.mapGameMode("king's row")).toBe('hybrid')
  })

  it('unknown hero / map returns the input unchanged (graceful degrade)', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const api = useOWData()
    await new Promise(r => setTimeout(r, 0))
    expect(api.heroDisplayName('nonexistent-hero')).toBe('nonexistent-hero')
    expect(api.mapDisplayName('paris')).toBe('paris') // not in fixture
    expect(api.mapDisplayName("kings row")).toBe('kings row') // missing apostrophe — won't match
  })

  it('apostrophes are NOT normalized — must match exactly (Go normalize parity)', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const api = useOWData()
    await new Promise(r => setTimeout(r, 0))
    // The Go side's normalize() doesn't strip apostrophes, so the
    // JS normalize() doesn't either. Stored keys must preserve the
    // apostrophe; "kings row" can't resolve to "King's Row".
    expect(api.mapDisplayName("king's row")).toBe("King's Row")
  })

  it('null/undefined/empty inputs return empty string', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const api = useOWData()
    expect(api.heroDisplayName(null)).toBe('')
    expect(api.heroDisplayName(undefined)).toBe('')
    expect(api.heroDisplayName('')).toBe('')
    expect(api.mapDisplayName(null)).toBe('')
    expect(api.heroRole(null)).toBe('')
    expect(api.mapGameMode(null)).toBe('')
  })

  it('fetch rejection leaves the lookups empty but the API still works', async () => {
    getOWDataMock.mockRejectedValue(new Error('network down'))
    const useOWData = await freshOWData()
    const api = useOWData()
    await new Promise(r => setTimeout(r, 0))
    // Lookups return the input verbatim — no exception bubbles up.
    expect(api.heroDisplayName('lucio')).toBe('lucio')
    expect(api.mapDisplayName('kings row')).toBe('kings row')
    expect(api.data.value).toBeNull()
  })

  it('exposes seasons, chapter grouping, and a name→window resolver', async () => {
    getOWDataMock.mockResolvedValue(SAMPLE_DATA)
    const useOWData = await freshOWData()
    const ow = useOWData()
    // The query pipeline resolves over several microtask turns — a macrotask
    // tick (same as the other cases in this file) lets it settle.
    await new Promise(r => setTimeout(r, 0))

    expect(ow.seasons.value).toHaveLength(2)
    expect(ow.seasonsByChapter.value).toEqual([
      { chapter: 'Reign of Talon', seasons: SAMPLE_DATA.seasons },
    ])
    const w = ow.seasonWindow('Reign of Talon — Season 2')
    expect(w).toEqual({
      startMs: Date.parse('2026-04-14T19:00:00Z'),
      endMs: Date.parse('2026-06-16T19:00:00Z'),
    })
    expect(ow.seasonWindow('nope')).toBeNull()
  })

})
