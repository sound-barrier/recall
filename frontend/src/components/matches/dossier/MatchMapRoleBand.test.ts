import { describe, it, expect, vi } from 'vitest'
import { mountWidget } from '@/test-utils/mountWidget'
import type { MapRoleCell } from '@/composables/matches/useMatchesDossier'

// Stub the reference-data singleton so the column roster is
// deterministic (no fetch, no cross-test singleton state). Three maps
// across two game-mode groups: Ilios (control), Dorado + Rialto (escort).
vi.mock('@/composables/shared/useOWData', async () => {
  const { computed } = await import('vue')
  const idx = new Map<string, { display: string; gameMode: string }>([
    ['ilios', { display: 'Ilios', gameMode: 'control' }],
    ['dorado', { display: 'Dorado', gameMode: 'escort' }],
    ['rialto', { display: 'Rialto', gameMode: 'escort' }],
  ])
  return {
    useOWData: () => ({
      data: computed(() => null),
      mapIndex: computed(() => idx),
      heroIndex: computed(() => new Map()),
      mapDisplayName: (s: string | null | undefined) => (s ? idx.get(s)?.display ?? s : ''),
      heroDisplayName: (s: string) => s,
      heroRole: () => '',
      mapGameMode: (s: string | null | undefined) => (s ? idx.get(s)?.gameMode ?? '' : ''),
    }),
  }
})

// Import AFTER the mock so the component picks up the stub.
const { default: MatchMapRoleBand } = await import('@/components/matches/dossier/MatchMapRoleBand.vue')

const CELLS: MapRoleCell[] = [
  // Rialto/support is the volume anchor (maxTotal = 12).
  { map: 'rialto', role: 'support', wins: 8, losses: 4, draws: 0, total: 12, winrate: 67 },
  { map: 'ilios', role: 'tank', wins: 2, losses: 2, draws: 0, total: 4, winrate: 50 },
  // dorado/dps keeps all three roles "played" so the structural tests below
  // (3 role rows) still hold now that never-played roles are hidden.
  { map: 'dorado', role: 'dps', wins: 1, losses: 1, draws: 0, total: 2, winrate: 50 },
]

function mountBand(narrow = {}) {
  return mountWidget(MatchMapRoleBand, { dossier: { mapRoleCounts: CELLS }, narrow })
}

describe('MatchMapRoleBand', () => {
  it('renders 3 role rows × all map columns grouped by game mode', () => {
    const w = mountBand()
    expect(w.findAll('.mr-rowhead')).toHaveLength(3)
    expect(w.findAll('.mr-collabel')).toHaveLength(3) // ilios + dorado + rialto
    expect(w.findAll('.mr-modehead')).toHaveLength(2) // control + escort
    expect(w.findAll('.mr-cell')).toHaveLength(3 * 3) // 3 roles × 3 maps
  })

  it('orders maps alphabetically within a type group', () => {
    const w = mountBand()
    const labels = w.findAll('.mr-collabel').map((n) => n.text())
    // Escort group: Dorado precedes Rialto.
    expect(labels.indexOf('Dorado')).toBeLessThan(labels.indexOf('Rialto'))
  })

  it('disables unplayed cells and labels them as having no matches', () => {
    const w = mountBand()
    const empty = w.find('[aria-label="Support on Ilios: no matches"]')
    expect(empty.exists()).toBe(true)
    expect(empty.attributes('disabled')).toBeDefined()
  })

  it('clicking a populated cell narrows to that (map, role)', async () => {
    const pickMap = vi.fn()
    const pickRole = vi.fn()
    const w = mountBand({ pickMap, pickRole })
    await w.find('[aria-label^="Support on Rialto"]').trigger('click')
    expect(pickMap).toHaveBeenCalledWith('rialto')
    expect(pickRole).toHaveBeenCalledWith('support')
  })

  it('clicking a game-mode group header narrows to that game-mode', async () => {
    const pickGameMode = vi.fn()
    const w = mountBand({ pickGameMode })
    const escort = w.findAll('.mr-modehead').find((n) => n.text() === 'Escort')
    await escort?.trigger('click')
    expect(pickGameMode).toHaveBeenCalledWith('escort')
  })

  it('offers a 1M/3M/6M/12M window toggle defaulting to 6M', () => {
    const w = mountBand()
    const btns = w.findAll('.mr-window-btn')
    expect(btns.map((b) => b.text())).toEqual(['1M', '3M', '6M', '12M'])
    const active = btns.find((b) => b.attributes('aria-pressed') === 'true')
    expect(active?.text()).toBe('6M')
  })

  it('persists the chosen window and marks it active', async () => {
    const w = mountBand()
    const oneMonth = w.findAll('.mr-window-btn').find((b) => b.text() === '1M')
    await oneMonth?.trigger('click')
    expect(oneMonth?.attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem('recall.mapRoleWindowMonths')).toBe('1')
  })

  it('hides the row for a role the player has never played', () => {
    // Only tank + support carry matches; DPS has none, so its row drops out.
    const noDps: MapRoleCell[] = [
      { map: 'rialto', role: 'support', wins: 8, losses: 4, draws: 0, total: 12, winrate: 67 },
      { map: 'ilios', role: 'tank', wins: 2, losses: 2, draws: 0, total: 4, winrate: 50 },
    ]
    const w = mountWidget(MatchMapRoleBand, { dossier: { mapRoleCounts: noDps } })
    const rows = w.findAll('.mr-rowhead').map((n) => n.text())
    expect(rows).toEqual(['Tank', 'Support'])
    expect(rows).not.toContain('DPS')
  })

  it('prompts to play a match when there are none, instead of an empty grid', () => {
    const w = mountWidget(MatchMapRoleBand, { dossier: { mapRoleCounts: [] } })
    expect(w.find('.mr-grid').exists()).toBe(false)
    expect(w.text().toLowerCase()).toContain('at least 1 match must be played to display data')
  })

  // The win-rate-hue × volume-saturation math lives in
  // winrateVolumeFill (match-helpers) and is unit-tested there —
  // happy-dom drops color-mix() from a serialized style attribute, so
  // it can't be asserted through the DOM here.
})
