import { describe, it, expect, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { mountWidget } from '@/test-utils/mountWidget'
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
  { hero: 'lucio', gameMode: 'control',    wins: 8, losses: 2, draws: 0, total: 10, winrate: 80 },
  { hero: 'lucio', gameMode: 'escort',     wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
  { hero: 'lucio', gameMode: 'flashpoint', wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
  { hero: 'lucio', gameMode: 'hybrid',     wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
  { hero: 'lucio', gameMode: 'push',       wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
  { hero: 'lucio', gameMode: 'clash',      wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
]
const MAP_CELLS = [
  { map: 'route66', wins: 6, losses: 4, draws: 0, total: 10, winrate: 60 },
  { map: 'havana',  wins: 3, losses: 1, draws: 0, total: 4,  winrate: 75 },
]
const RECENT = [
  { matchKey: 'm1', date: '2026-05-03', finishedAt: '21:00', result: 'victory', map: 'route66' },
  { matchKey: 'm2', date: '2026-05-01', finishedAt: '20:00', result: 'defeat',  map: 'route66' },
]
const FLOOR_CONFIG = { 'hero-game-mode-heatmap': { heroLimit: 8, minMatches: 10 } }

describe('MatchHeroModeBand', () => {
  it('renders the root empty-state when decisive matches are below the floor', () => {
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      dossier: { heroGameModeCounts: [{ hero: 'lucio', gameMode: 'control', wins: 2, losses: 2, draws: 0, total: 4, winrate: 50 }] },
    })
    expect(wrapper.text()).toContain('decisive matches')
    expect(wrapper.find('.heatmap-grid').exists()).toBe(false)
  })

  it('prompts to play a match when there are none at all (not the floor message)', () => {
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      dossier: { heroGameModeCounts: [] },
    })
    expect(wrapper.text()).toContain('At least 1 match must be played to display data')
    expect(wrapper.text()).not.toContain('decisive matches')
    expect(wrapper.find('.heatmap-grid').exists()).toBe(false)
  })

  it('renders the root hero × game-mode grid above the floor', () => {
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS },
    })
    expect(wrapper.find('.heatmap-grid').exists()).toBe(true)
    // Five columns: clash (quickplay-only, 0 data in ROOT_CELLS) is gated out.
    expect(wrapper.findAll('.heatmap-colhead')).toHaveLength(5)
    expect(wrapper.find('[data-hm-col="clash"]').exists()).toBe(false)
    expect(wrapper.find('.heatmap-rowhead').text()).toContain('lucio')
  })

  it('shows the Clash column once there is Clash data', () => {
    const cells = ROOT_CELLS.map((c) =>
      c.gameMode === 'clash' ? { ...c, wins: 2, losses: 1, draws: 0, total: 3, winrate: 67 } : c,
    )
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: cells },
    })
    expect(wrapper.findAll('.heatmap-colhead')).toHaveLength(6)
    expect(wrapper.find('[data-hm-col="clash"]').exists()).toBe(true)
  })

  it('clicking a root cell narrows (hero, mode) and drills into the maps level', async () => {
    const narrow = makeNarrow()
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await wrapper.find('.heatmap-cell.cell-win').trigger('click')
    // Global narrow applied.
    expect(narrow.pickHero).toHaveBeenCalledWith('lucio')
    expect(narrow.pickGameMode).toHaveBeenCalledWith('control')
    // Band drilled to the maps level — root grid gone, map tiles shown.
    expect(wrapper.find('.heatmap-grid').exists()).toBe(false)
    expect(wrapper.find('[data-hero-mode-maps]').exists()).toBe(true)
    const tiles = wrapper.findAll('.hm-map-tile')
    expect(tiles.length).toBe(2)
    const tileText = tiles.map((t) => t.text()).join(' ')
    expect(tileText).toContain('route66')
    expect(tileText).toContain('60%')
    expect(wrapper.find('.hm-title').text()).toContain('lucio × Control maps')
    expect(wrapper.find('[data-hero-mode-back]').exists()).toBe(true)
  })

  it('sorts the drilled-down maps alphabetically by name, not by volume', async () => {
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow: makeNarrow(),
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await wrapper.find('.heatmap-cell.cell-win').trigger('click')
    // route66 has more games (10 vs 4) but havana sorts first alphabetically.
    const names = wrapper.findAll('.hm-map-tile .hm-map-name').map((n) => n.text())
    expect(names).toEqual(['havana', 'route66'])
  })

  it('Go back pops to the root and reverts only the picks the band applied', async () => {
    const narrow = makeNarrow()
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await wrapper.find('.heatmap-cell.cell-win').trigger('click')
    expect(narrow.pickedHeroes.value.has('lucio')).toBe(true)
    await wrapper.find('[data-hero-mode-back]').trigger('click')
    // Back to root; the band-applied picks are reverted.
    expect(wrapper.find('.heatmap-grid').exists()).toBe(true)
    expect(narrow.pickedHeroes.value.has('lucio')).toBe(false)
    expect(narrow.pickedGameModes.value.has('control')).toBe(false)
  })

  it('a guarded drill does not toggle off a dimension the user pre-filtered', async () => {
    const narrow = makeNarrow()
    narrow.pickedGameModes.value = new Set(['control']) // user already filtered to Control
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await wrapper.find('.heatmap-cell.cell-win').trigger('click')
    // Hero added by us; game-mode left alone (already present).
    expect(narrow.pickHero).toHaveBeenCalledWith('lucio')
    expect(narrow.pickGameMode).not.toHaveBeenCalled()
    await wrapper.find('[data-hero-mode-back]').trigger('click')
    // Go-back reverts only the hero; the user's Control filter survives.
    expect(narrow.pickedHeroes.value.has('lucio')).toBe(false)
    expect(narrow.pickedGameModes.value.has('control')).toBe(true)
  })

  it('clicking a map tile drills into the recent-matches level', async () => {
    const narrow = makeNarrow()
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS, recentMatches: RECENT },
    })
    await wrapper.find('.heatmap-cell.cell-win').trigger('click')
    // Maps now sort alphabetically (havana before route66), so target route66 by name.
    const route66Tile = wrapper.findAll('.hm-map-tile').find((t) => t.text().includes('route66'))
    await route66Tile!.trigger('click')
    expect(narrow.pickMap).toHaveBeenCalledWith('route66')
    expect(wrapper.find('[data-hero-mode-matches]').exists()).toBe(true)
    const matchRows = wrapper.findAll('.hm-match-row')
    expect(matchRows.length).toBe(2)
    expect(matchRows[0]!.text().toLowerCase()).toContain('victory')
    expect(wrapper.find('.hm-title').text()).toContain('route66 · recent matches')
  })

  it('reconciles the stack when the picks are cleared externally', async () => {
    const narrow = makeNarrow()
    const wrapper = mountWidget(MatchHeroModeBand, {
      narrow,
      configSeed: FLOOR_CONFIG,
      dossier: { heroGameModeCounts: ROOT_CELLS, mapCounts: MAP_CELLS },
    })
    await wrapper.find('.heatmap-cell.cell-win').trigger('click')
    expect(wrapper.find('[data-hero-mode-maps]').exists()).toBe(true)
    // Simulate a rail "clear filters": drop the hero pick.
    narrow.pickedHeroes.value = new Set()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-hero-mode-maps]').exists()).toBe(false)
    expect(wrapper.find('.heatmap-grid').exists()).toBe(true)
  })

  it('renders the trailing-window picker defaulting to 6M and persists a pick', async () => {
    const wrapper = mountWidget(MatchHeroModeBand, { narrow: makeNarrow(), dossier: { heroGameModeCounts: [] } })
    const buttons = wrapper.findAll('.hm-window-btn')
    expect(buttons).toHaveLength(4)
    expect(buttons[2]!.attributes('aria-pressed')).toBe('true')
    await buttons[1]!.trigger('click')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem('recall.heroModeWindowMonths')).toBe('3')
  })

  it('the gear toggles its expanded state (root level)', async () => {
    const wrapper = mountWidget(MatchHeroModeBand, { narrow: makeNarrow(), dossier: { heroGameModeCounts: [] } })
    const gear = wrapper.find('[data-hero-mode-config-trigger]')
    expect(gear.attributes('aria-expanded')).toBe('false')
    await gear.trigger('click')
    expect(gear.attributes('aria-expanded')).toBe('true')
  })
})
