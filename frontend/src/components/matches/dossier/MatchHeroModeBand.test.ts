import { describe, it, expect, vi } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import { screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { renderWidget } from '@/test-utils'
import MatchHeroModeBand from '@/components/matches/dossier/MatchHeroModeBand.vue'

// Mock useOWData to avoid the singleton's GetOWData() side-effect.
vi.mock('@/composables/shared/useOWData', () => ({
  useOWData: () => ({
    heroDisplayName: (s: string) => s,   // pass-through; tests assert on slugs
    mapDisplayName:  (s: string) => s,
    heroRole:        () => '',
    mapGameMode:     () => '',
    data:            { value: null },
    heroIndex:       { value: new Map() },
    mapIndex:        { value: new Map() },
  }),
}))

// A realistic narrow stub: pick* spies actually toggle the picked sets
// (like the real toggleSet) so the band's guarded-add + reconciliation
// watcher exercise correctly, while still recording calls.
function makeNarrow() {
  const pickedHeroes    = ref(new Set<string>())
  const pickedGameModes = ref(new Set<string>())
  const pickedMaps      = ref(new Set<string>())
  const toggle = (r: Ref<Set<string>>, v: string) => {
    const n = new Set(r.value)
    if (n.has(v)) n.delete(v); else n.add(v)
    r.value = n
  }
  return {
    pickedHeroes, pickedGameModes, pickedMaps,
    pickHero:     vi.fn((v: string) => toggle(pickedHeroes, v)),
    pickGameMode: vi.fn((v: string) => toggle(pickedGameModes, v)),
    pickMap:      vi.fn((v: string) => toggle(pickedMaps, v)),
  }
}

// A root corpus with one populated lucio/control cell (above a 10-floor).
const ROOT_CELLS = [
  // 16W/4L: 80% over 20 decisive — past the 15-decisive floor and the win band
  // (the drill tests below click the win-colored cell).
  { hero: 'lucio', gameMode: 'control',    wins: 16, losses: 4, draws: 0, total: 20, winrate: 80 },
  { hero: 'lucio', gameMode: 'escort',     wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
  { hero: 'lucio', gameMode: 'flashpoint', wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
  { hero: 'lucio', gameMode: 'hybrid',     wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
  { hero: 'lucio', gameMode: 'push',       wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
  { hero: 'lucio', gameMode: 'clash',      wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
]
const MAP_CELLS = [
  { map: 'route66', wins: 14, losses: 6, draws: 0, total: 20, winrate: 70 },
  { map: 'havana',  wins: 3, losses: 1, draws: 0, total: 4,  winrate: 75 },
]
const RECENT = [
  { matchKey: 'm1', date: '2026-05-03', finishedAt: '21:00', result: 'victory', map: 'route66' },
  { matchKey: 'm2', date: '2026-05-01', finishedAt: '20:00', result: 'defeat',  map: 'route66' },
]
const FLOOR_CONFIG = { 'hero-game-mode-heatmap': { heroLimit: 8, minMatches: 10 } }

const user = () => userEvent.setup()

const winCell   = () => screen.getByRole('gridcell', { name: /lucio on control: 80% winrate/ })
const colheads  = () => screen.queryAllByRole('columnheader', { name: /Select all heroes on/ })
const mapTiles  = () => screen.queryAllByRole('button', { name: /Click for recent matches/ })
const tileNames = () => mapTiles().map((t) => (t.getAttribute('aria-label') ?? '').split(':')[0])
const backBtn   = () => screen.getByRole('button', { name: /Go back/ })

describe('MatchHeroModeBand', () => {
  it('renders the root empty-state when decisive matches are below the floor', () => {
    renderWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      dossier: { heroGameModeCounts: [{ hero: 'lucio', gameMode: 'control', wins: 2, losses: 2, draws: 0, total: 4, winrate: 50 }] },
    })
    expect(screen.getByText(/decisive matches/)).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('prompts to play a match when there are none at all (not the floor message)', () => {
    renderWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      dossier: { heroGameModeCounts: [] },
    })
    expect(screen.getByText(/At least 1 match must be played to display data/)).toBeInTheDocument()
    expect(screen.queryByText(/decisive matches/)).not.toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('renders the root hero × game-mode grid above the floor', () => {
    renderWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS },
    })
    expect(screen.getByRole('grid')).toBeInTheDocument()
    // Five columns: clash (quickplay-only, 0 data in ROOT_CELLS) is gated out.
    expect(colheads()).toHaveLength(5)
    expect(screen.queryByRole('columnheader', { name: 'Select all heroes on clash' })).not.toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: /lucio/ })).toBeInTheDocument()
  })

  it('shows the Clash column once there is Clash data', () => {
    const cells = ROOT_CELLS.map((c) =>
      c.gameMode === 'clash' ? { ...c, wins: 2, losses: 1, draws: 0, total: 3, winrate: 67 } : c,
    )
    renderWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: cells },
    })
    expect(colheads()).toHaveLength(6)
    expect(screen.getByRole('columnheader', { name: 'Select all heroes on clash' })).toBeInTheDocument()
  })

  it('clicking a root cell narrows (hero, mode) and drills into the maps level', async () => {
    const narrow = makeNarrow()
    renderWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    const cell = winCell()
    // heatmapCellClass is a THRESHOLD verdict; the shared engine's contract
    // is that the same win rate paints the same band here and in the Map ×
    // Role band — and now SPEAKS it, so the tint is not the only carrier.
    expect(cell).toHaveAccessibleName(/— winning\./)
    await user().click(cell)
    // Global narrow applied.
    expect(narrow.pickHero).toHaveBeenCalledWith('lucio')
    expect(narrow.pickGameMode).toHaveBeenCalledWith('control')
    // Band drilled to the maps level — root grid gone, map tiles shown.
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    const tiles = mapTiles()
    expect(tiles).toHaveLength(2)
    const tileText = tiles.map((t) => t.textContent).join(' ')
    expect(tileText).toContain('route66')
    expect(tileText).toContain('70%')
    expect(screen.getByRole('heading', { name: /lucio × Control maps/ })).toBeInTheDocument()
    expect(backBtn()).toBeInTheDocument()
  })

  it('speaks each drilled map tile\'s band, withholding one under the floor', async () => {
    renderWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await user().click(winCell())
    // route66: 14-6 over 20 decisive — judged. havana: 3-1 over 4 — the
    // tile greys out, so its name must not claim a verdict either.
    expect(screen.getByRole('button', { name: /^route66/ })).toHaveAccessibleName(/— winning\./)
    const heater = screen.getByRole('button', { name: /^havana/ })
    expect(heater).toHaveAccessibleName(/— too few games to judge\./)
    expect(heater).not.toHaveAccessibleName(/winning|losing/)
  })

  it('sorts the drilled-down maps alphabetically by name, not by volume', async () => {
    renderWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await user().click(winCell())
    // route66 has more games (10 vs 4) but havana sorts first alphabetically.
    expect(tileNames()).toEqual(['havana', 'route66'])
  })

  it('Go back pops to the root and reverts only the picks the band applied', async () => {
    const narrow = makeNarrow()
    renderWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await user().click(winCell())
    expect(narrow.pickedHeroes.value.has('lucio')).toBe(true)
    await user().click(backBtn())
    // Back to root; the band-applied picks are reverted.
    expect(screen.getByRole('grid')).toBeInTheDocument()
    expect(narrow.pickedHeroes.value.has('lucio')).toBe(false)
    expect(narrow.pickedGameModes.value.has('control')).toBe(false)
  })

  it('a guarded drill does not toggle off a dimension the user pre-filtered', async () => {
    const narrow = makeNarrow()
    narrow.pickedGameModes.value = new Set(['control']) // user already filtered to Control
    renderWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await user().click(winCell())
    // Hero added by us; game-mode left alone (already present).
    expect(narrow.pickHero).toHaveBeenCalledWith('lucio')
    expect(narrow.pickGameMode).not.toHaveBeenCalled()
    await user().click(backBtn())
    // Go-back reverts only the hero; the user's Control filter survives.
    expect(narrow.pickedHeroes.value.has('lucio')).toBe(false)
    expect(narrow.pickedGameModes.value.has('control')).toBe(true)
  })

  it('clicking a map tile drills into the recent-matches level', async () => {
    const narrow = makeNarrow()
    renderWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS, recentMatches: RECENT },
    })
    await user().click(winCell())
    // Maps now sort alphabetically (havana before route66), so target route66 by name.
    await user().click(screen.getByRole('button', { name: /^route66:/ }))
    expect(narrow.pickMap).toHaveBeenCalledWith('route66')
    const matchRows = screen.getAllByTitle(/^Open /)
    expect(matchRows).toHaveLength(2)
    expect(matchRows[0]!.textContent!.toLowerCase()).toContain('victory')
    expect(screen.getByRole('heading', { name: /route66 · recent matches/ })).toBeInTheDocument()
  })

  it('reconciles the stack when the picks are cleared externally', async () => {
    const narrow = makeNarrow()
    renderWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await user().click(winCell())
    expect(mapTiles().length).toBeGreaterThan(0)
    // Simulate a rail "clear filters": drop the hero pick.
    narrow.pickedHeroes.value = new Set()
    await nextTick()
    expect(mapTiles()).toHaveLength(0)
    expect(screen.getByRole('grid')).toBeInTheDocument()
  })

  it('renders the trailing-window picker defaulting to 6M and persists a pick', async () => {
    renderWidget(MatchHeroModeBand, { narrow: makeNarrow(), dossier: { heroGameModeCounts: [] } })
    const buttons = screen.getAllByRole('button', { name: /^\d+M$/ })
    expect(buttons).toHaveLength(4)
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true')
    await user().click(buttons[1]!)
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('recall.heroModeWindowMonths')).toBe('3')
  })

  it('the gear toggles its expanded state (root level)', async () => {
    renderWidget(MatchHeroModeBand, { narrow: makeNarrow(), dossier: { heroGameModeCounts: [] } })
    const gear = screen.getByRole('button', { name: 'Configure the Hero × Game-Mode band' })
    expect(gear).toHaveAttribute('aria-expanded', 'false')
    await user().click(gear)
    expect(gear).toHaveAttribute('aria-expanded', 'true')
  })
})
