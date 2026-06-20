import { describe, it, expect, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
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
    ['hanaoka', { display: 'Hanaoka', gameMode: 'clash' }], // non-competitive — data-gated
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

// The band reads narrow.pickedMaps / pickedRoles (for the selected highlight)
// and writes them on click (single-select), so every mount needs those refs.
function makeNarrow(overrides: Record<string, unknown> = {}) {
  return {
    pickedMaps:  ref(new Set<string>()),
    pickedRoles: ref(new Set<string>()),
    ...overrides,
  }
}

function mountBand(narrow: ReturnType<typeof makeNarrow> = makeNarrow()) {
  return mountWidget(MatchMapRoleBand, { dossier: { mapRoleCounts: CELLS }, narrow })
}

// A bare cell press: mousedown begins the gesture (the engine arms window
// listeners), a window mouseup with no movement commits it as a click.
async function press(cell: ReturnType<VueWrapper['find']>) {
  await cell.trigger('mousedown')
  window.dispatchEvent(new MouseEvent('mouseup'))
  await nextTick()
}

describe('MatchMapRoleBand', () => {
  it('renders 3 role rows × all map columns grouped by game mode', () => {
    const w = mountBand()
    expect(w.findAll('.mr-rowhead')).toHaveLength(3)
    expect(w.findAll('.mr-collabel')).toHaveLength(3) // ilios + dorado + rialto (Hanaoka/clash hidden)
    expect(w.findAll('.mr-modehead')).toHaveLength(2) // control + escort (no clash group)
    expect(w.findAll('.mr-cell')).toHaveLength(3 * 3) // 3 roles × 3 maps
  })

  it('hides Clash maps (non-competitive) until there is data for them', () => {
    // No Clash data → Hanaoka gets no column.
    expect(mountBand().findAll('.mr-collabel').map((n) => n.text())).not.toContain('Hanaoka')
    // A Clash match → the column (and its game-mode group) appears.
    const withClash = mountWidget(MatchMapRoleBand, {
      dossier: { mapRoleCounts: [
        ...CELLS,
        { map: 'hanaoka', role: 'tank', wins: 1, losses: 0, draws: 0, total: 1, winrate: 100 },
      ] },
      narrow: makeNarrow(),
    })
    expect(withClash.findAll('.mr-collabel').map((n) => n.text())).toContain('Hanaoka')
  })

  it('takes rows + selectable cells from the UNFILTERED dossier so a narrow never collapses the grid', () => {
    // Narrowed view = a single map+role (as if that cell were picked); the
    // unfiltered view still has all three roles played. The grid must stay at
    // three rows — the calendar-consistent "structure stays put" contract.
    const w = mountWidget(MatchMapRoleBand, {
      dossier:     { mapRoleCounts: [CELLS[0]!] }, // narrowed → only rialto/support has data
      fullDossier: { mapRoleCounts: CELLS },        // unfiltered → all 3 roles played
      narrow: makeNarrow({
        pickedMaps:  ref(new Set(['rialto'])),
        pickedRoles: ref(new Set(['support'])),
      }),
    })
    // Rows come from the full structure (3 roles), not the one the narrow leaves.
    expect(w.findAll('.mr-rowhead')).toHaveLength(3)
    // All three cells played in the window stay playable (not flagged empty), even
    // though only one has data under the narrow — calendar-style switching / click-off.
    const playable = w.findAll('.mr-cell').filter((c) => c.attributes('data-mr-empty') === undefined)
    expect(playable).toHaveLength(3)
  })

  it('orders maps alphabetically within a type group', () => {
    const w = mountBand()
    const labels = w.findAll('.mr-collabel').map((n) => n.text())
    // Escort group: Dorado precedes Rialto.
    expect(labels.indexOf('Dorado')).toBeLessThan(labels.indexOf('Rialto'))
  })

  it('flags unplayed cells empty (clickable to reset) and labels them no matches', () => {
    const w = mountBand()
    const empty = w.find('[aria-label="Support on Ilios: no matches"]')
    expect(empty.exists()).toBe(true)
    expect(empty.attributes('data-mr-empty')).toBeDefined()
    // No longer :disabled — an empty cell is clickable so a click can reset.
    expect(empty.attributes('disabled')).toBeUndefined()
  })

  it('clicking an empty cell resets this band\'s filter', async () => {
    const narrow = makeNarrow({
      pickedMaps:  ref(new Set(['rialto'])),
      pickedRoles: ref(new Set(['support'])),
    })
    const w = mountBand(narrow)
    await press(w.find('[aria-label="Support on Ilios: no matches"]')) // empty cell
    expect(narrow.pickedMaps.value.size).toBe(0)
    expect(narrow.pickedRoles.value.size).toBe(0)
  })

  it('shows a header Reset when the filter is active; clicking it clears the filter', async () => {
    const narrow = makeNarrow({
      pickedMaps:  ref(new Set(['rialto'])),
      pickedRoles: ref(new Set(['support'])),
    })
    const w = mountBand(narrow)
    const reset = w.find('[data-mr-reset]')
    expect(reset.exists()).toBe(true)
    await reset.trigger('click')
    expect(narrow.pickedMaps.value.size).toBe(0)
    expect(narrow.pickedRoles.value.size).toBe(0)
    expect(w.find('[data-mr-reset]').exists()).toBe(false) // hides once cleared
  })

  it('selecting a cell highlights it AND live-filters the set (no button)', async () => {
    const narrow = makeNarrow()
    const w = mountBand(narrow)
    const cell = () => w.find('[aria-label^="Support on Rialto"]')
    await press(cell())
    expect(cell().classes()).toContain('selected')
    expect(cell().attributes('aria-pressed')).toBe('true')
    expect(w.findAll('.mr-cell.selected')).toHaveLength(1)
    // Selecting now narrows immediately — no "Filter to selection" step.
    expect([...narrow.pickedMaps.value]).toEqual(['rialto'])
    expect([...narrow.pickedRoles.value]).toEqual(['support'])
  })

  it('clicking the selected cell again clears it (click off)', async () => {
    const w = mountBand()
    const cell = () => w.find('[aria-label^="Support on Rialto"]')
    await press(cell())
    await press(cell())
    expect(cell().classes()).not.toContain('selected')
    expect(w.find('[data-mr-selection-bar]').exists()).toBe(false)
  })

  it('clicking another cell replaces the selection — never two highlighted cells', async () => {
    const w = mountBand()
    await press(w.find('[aria-label^="Support on Rialto"]'))
    await press(w.find('[aria-label^="Tank on Ilios"]'))
    expect(w.findAll('.mr-cell.selected')).toHaveLength(1)
    expect(w.find('[aria-label^="Tank on Ilios"]').classes()).toContain('selected')
  })

  it('clicking a role label selects the whole row', async () => {
    const w = mountBand()
    await w.find('[data-mr-row="support"]').trigger('click')
    // The two played support cells (rialto, dorado/ilios are inert for support) light up.
    expect(w.find('[aria-label^="Support on Rialto"]').classes()).toContain('selected')
    expect(w.find('[data-mr-selection-bar]').exists()).toBe(true)
  })

  it('clicking a map name selects the whole column', async () => {
    const w = mountBand()
    await w.find('[data-mr-col="rialto"]').trigger('click')
    expect(w.find('[aria-label^="Support on Rialto"]').classes()).toContain('selected')
  })

  it('Ctrl-clicking a second cell live-filters to the rectangular hull', async () => {
    const narrow = makeNarrow()
    const w = mountBand(narrow)
    await press(w.find('[aria-label^="Support on Rialto"]'))
    const tank = w.find('[aria-label^="Tank on Ilios"]')
    await tank.trigger('mousedown', { ctrlKey: true })
    window.dispatchEvent(new MouseEvent('mouseup', { ctrlKey: true }))
    await nextTick()
    expect(w.findAll('.mr-cell.selected')).toHaveLength(2)
    // The narrow tracks the selection's hull (maps × roles) live, no button.
    expect([...narrow.pickedMaps.value].sort()).toEqual(['ilios', 'rialto'])
    expect([...narrow.pickedRoles.value].sort()).toEqual(['support', 'tank'])
  })

  it('shows the combined-stats readout for the selection', async () => {
    const w = mountBand()
    await press(w.find('[aria-label^="Support on Rialto"]'))
    const stats = w.find('[data-mr-selection-stats]')
    expect(stats.exists()).toBe(true)
    // rialto/support = 8-4-0, 67% WR over 12 games
    expect(stats.text()).toContain('8–4–0')
    expect(stats.text()).toContain('67% WR')
    expect(stats.text()).toContain('12 games')
  })

  it('reserves the readout slot — an empty prompt shows until a cell is selected', async () => {
    const w = mountBand()
    // Nothing selected: the prompt fills the slot, the active bar is absent.
    expect(w.find('[data-mr-selection-empty]').exists()).toBe(true)
    expect(w.find('[data-mr-selection-bar]').exists()).toBe(false)
    // Selecting swaps the prompt for the active bar in the same slot (no shift).
    await press(w.find('[aria-label^="Support on Rialto"]'))
    expect(w.find('[data-mr-selection-bar]').exists()).toBe(true)
    expect(w.find('[data-mr-selection-empty]').exists()).toBe(false)
  })

  it("clicking a game-mode group header selects that group's columns", async () => {
    const w = mountBand()
    const escort = w.findAll('.mr-modehead').find((n) => n.text() === 'Escort')
    await escort?.trigger('click')
    // Escort = Dorado + Rialto; played cells there: dorado|dps + rialto|support.
    expect(w.findAll('.mr-cell.selected')).toHaveLength(2)
    expect(w.find('[data-mr-selection-bar]').exists()).toBe(true)
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
    const w = mountWidget(MatchMapRoleBand, { dossier: { mapRoleCounts: noDps }, narrow: makeNarrow() })
    const rows = w.findAll('.mr-rowhead').map((n) => n.text())
    expect(rows).toEqual(['Tank', 'Support'])
    expect(rows).not.toContain('DPS')
  })

  it('prompts to play a match when there are none, instead of an empty grid', () => {
    const w = mountWidget(MatchMapRoleBand, { dossier: { mapRoleCounts: [] }, narrow: makeNarrow() })
    expect(w.find('.mr-grid').exists()).toBe(false)
    expect(w.text().toLowerCase()).toContain('at least 1 match must be played to display data')
  })

  // The win-rate-hue × volume-saturation math lives in
  // winrateVolumeFill (match-helpers) and is unit-tested there —
  // happy-dom drops color-mix() from a serialized style attribute, so
  // it can't be asserted through the DOM here.
})
