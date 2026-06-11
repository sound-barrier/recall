import { describe, it, expect, vi } from 'vitest'
import { mountWidget } from '../../test-utils/mountWidget'
import HeroGameModeHeatmapWidget from './HeroGameModeHeatmapWidget.vue'

// Mock useOWData to avoid the singleton's GetOWData() side-effect.
vi.mock('../../composables/useOWData', () => ({
  useOWData: () => ({
    heroDisplayName: (s: string) => s,   // pass-through; tests assert on slugs
    mapDisplayName:  (s: string) => s,
    heroRole:        () => '',
    mapGameMode:         () => '',
    data:            { value: null },
    heroIndex:       { value: new Map() },
    mapIndex:        { value: new Map() },
  }),
}))

describe('HeroGameModeHeatmapWidget', () => {
  it('renders the empty-state copy when decisive matches are below the floor', () => {
    const wrapper = mountWidget(HeroGameModeHeatmapWidget, {
      dossier: {
        // 4 decisive matches — well under the default 20-match floor.
        heroGameModeCounts: [
          { hero: 'lucio', gameMode: 'control', wins: 2, losses: 2, draws: 0, total: 4, winrate: 50 },
        ],
      },
    })
    expect(wrapper.text()).toContain('Need 20+ decisive matches')
    expect(wrapper.find('.heatmap-grid').exists()).toBe(false)
  })

  it('renders the grid with row + column headers when above the floor', () => {
    const wrapper = mountWidget(HeroGameModeHeatmapWidget, {
      configSeed: { 'hero-game-mode-heatmap': { heroLimit: 8, minMatches: 10 } },
      dossier: {
        // 10 decisive matches on lucio/control alone — clears the
        // configured 10-match floor.
        heroGameModeCounts: [
          { hero: 'lucio', gameMode: 'control',    wins: 8, losses: 2, draws: 0, total: 10, winrate: 80 },
          { hero: 'lucio', gameMode: 'escort',     wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
          { hero: 'lucio', gameMode: 'flashpoint', wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
          { hero: 'lucio', gameMode: 'hybrid',     wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
          { hero: 'lucio', gameMode: 'push',       wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
          { hero: 'lucio', gameMode: 'clash',      wins: 0, losses: 0, draws: 0, total: 0,  winrate: 0  },
        ],
      },
    })
    expect(wrapper.find('.heatmap-grid').exists()).toBe(true)
    expect(wrapper.find('.heatmap-rowhead').text()).toContain('lucio')
    // 6 column headers — one per canonical game mode.
    expect(wrapper.findAll('.heatmap-colhead')).toHaveLength(6)
    // The populated cell carries the rate + volume labels.
    const populatedCell = wrapper.find('.heatmap-cell.cell-win')
    expect(populatedCell.text()).toContain('80%')
    expect(populatedCell.text()).toContain('10')
    // Empty cells render disabled with no label.
    const emptyCells = wrapper.findAll('.heatmap-cell.cell-empty')
    expect(emptyCells.length).toBeGreaterThan(0)
    expect((emptyCells[0]!.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('clicking a populated cell calls pickHero + pickGameMode', async () => {
    const pickHero    = vi.fn()
    const pickGameMode = vi.fn()
    const wrapper = mountWidget(HeroGameModeHeatmapWidget, {
      configSeed: { 'hero-game-mode-heatmap': { heroLimit: 8, minMatches: 10 } },
      dossier: {
        heroGameModeCounts: [
          { hero: 'ana', gameMode: 'flashpoint', wins: 7, losses: 3, draws: 0, total: 10, winrate: 70 },
        ],
      },
      narrow: { pickHero, pickGameMode },
    })
    const cell = wrapper.find('.heatmap-cell.cell-win')
    expect(cell.exists()).toBe(true)
    await cell.trigger('click')
    expect(pickHero).toHaveBeenCalledWith('ana')
    expect(pickGameMode).toHaveBeenCalledWith('flashpoint')
  })

  it('a winrate cell carries an aria-label that names the hero, game-mode, rate, and volume', () => {
    const wrapper = mountWidget(HeroGameModeHeatmapWidget, {
      configSeed: { 'hero-game-mode-heatmap': { heroLimit: 8, minMatches: 10 } },
      dossier: {
        heroGameModeCounts: [
          { hero: 'kiriko', gameMode: 'push', wins: 4, losses: 6, draws: 0, total: 10, winrate: 40 },
        ],
      },
    })
    const cell = wrapper.find('.heatmap-cell.cell-loss')
    const aria = cell.attributes('aria-label') ?? ''
    expect(aria).toContain('kiriko')
    expect(aria).toContain('push')
    expect(aria).toContain('40%')
    expect(aria).toContain('10 matches')
  })
})
