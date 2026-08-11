import { describe, it, expect, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { renderWidget } from '@/test-utils'
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
// and writes them on click (single-select), so every render needs those refs.
function makeNarrow(overrides: Record<string, unknown> = {}) {
  return {
    pickedMaps:  ref(new Set<string>()),
    pickedRoles: ref(new Set<string>()),
    ...overrides,
  }
}

function renderBand(narrow: ReturnType<typeof makeNarrow> = makeNarrow()) {
  return renderWidget(MatchMapRoleBand, { dossier: { mapRoleCounts: CELLS }, narrow })
}

// Accessible-name helpers — the band labels every interactive surface.
const rowheads  = () => screen.queryAllByLabelText(/^Select all maps for /)
const collabels = () => screen.queryAllByLabelText(/^Select all roles on /)
const modeheads = () => screen.queryAllByLabelText(/^Select all .+ maps$/)
const cells     = () => screen.queryAllByLabelText(/^(Tank|DPS|Support) on /)
// An unplayed cell says so in its own accessible name.
const playedCells = () => screen.queryAllByLabelText(/^(Tank|DPS|Support) on (?!.*: no matches$)/)
const selectedCells = () => cells().filter((c) => c.getAttribute('aria-pressed') === 'true')
const collabelTexts = () => collabels().map((n) => n.textContent?.trim())
// The selection bar and the "select a cell" prompt are a v-if/v-else
// pair in one reserved slot — the prompt's absence means the bar shows.
const emptyPrompt = () => screen.queryByText(/combined stats appear here/)

const user = () => userEvent.setup()

// A bare cell press: mousedown begins the gesture (the engine arms window
// listeners), a window mouseup with no movement commits it as a click.
async function press(cell: Element, init: MouseEventInit = {}) {
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...init }))
  window.dispatchEvent(new MouseEvent('mouseup', init))
  await nextTick()
}

describe('MatchMapRoleBand', () => {
  it('renders 3 role rows × all map columns grouped by game mode', () => {
    renderBand()
    expect(rowheads()).toHaveLength(3)
    expect(collabels()).toHaveLength(3) // ilios + dorado + rialto (Hanaoka/clash hidden)
    expect(modeheads()).toHaveLength(2) // control + escort (no clash group)
    expect(cells()).toHaveLength(3 * 3) // 3 roles × 3 maps
  })

  it('hides Clash maps (non-competitive) until there is data for them', () => {
    // No Clash data → Hanaoka gets no column.
    renderBand()
    expect(collabelTexts()).not.toContain('Hanaoka')
  })

  it('shows the Clash column once there is data for it', () => {
    // A Clash match → the column (and its game-mode group) appears.
    renderWidget(MatchMapRoleBand, {
      dossier: { mapRoleCounts: [
        ...CELLS,
        { map: 'hanaoka', role: 'tank', wins: 1, losses: 0, draws: 0, total: 1, winrate: 100 },
      ] },
      narrow: makeNarrow(),
    })
    expect(collabelTexts()).toContain('Hanaoka')
  })

  it('takes rows + selectable cells from the UNFILTERED dossier so a narrow never collapses the grid', () => {
    // Narrowed view = a single map+role (as if that cell were picked); the
    // unfiltered view still has all three roles played. The grid must stay at
    // three rows — the calendar-consistent "structure stays put" contract.
    renderWidget(MatchMapRoleBand, {
      dossier:     { mapRoleCounts: [CELLS[0]!] }, // narrowed → only rialto/support has data
      fullDossier: { mapRoleCounts: CELLS },        // unfiltered → all 3 roles played
      narrow: makeNarrow({
        pickedMaps:  ref(new Set(['rialto'])),
        pickedRoles: ref(new Set(['support'])),
      }),
    })
    // Rows come from the full structure (3 roles), not the one the narrow leaves.
    expect(rowheads()).toHaveLength(3)
    // All three cells played in the window stay playable (not flagged empty), even
    // though only one has data under the narrow — calendar-style switching / click-off.
    expect(playedCells()).toHaveLength(3)
  })

  it('orders maps alphabetically within a type group', () => {
    renderBand()
    const labels = collabelTexts()
    // Escort group: Dorado precedes Rialto.
    expect(labels.indexOf('Dorado')).toBeLessThan(labels.indexOf('Rialto'))
  })

  it('flags unplayed cells empty (clickable to reset) and labels them no matches', () => {
    renderBand()
    const empty = screen.getByLabelText('Support on Ilios: no matches')
    // The name IS the empty flag, and it stays out of the played set.
    expect(playedCells()).not.toContain(empty)
    // No longer :disabled — an empty cell is clickable so a click can reset.
    expect(empty).toBeEnabled()
  })

  it('clicking an empty cell resets this band\'s filter', async () => {
    const narrow = makeNarrow({
      pickedMaps:  ref(new Set(['rialto'])),
      pickedRoles: ref(new Set(['support'])),
    })
    renderBand(narrow)
    await press(screen.getByLabelText('Support on Ilios: no matches')) // empty cell
    expect(narrow.pickedMaps.value.size).toBe(0)
    expect(narrow.pickedRoles.value.size).toBe(0)
  })

  it('shows a header Reset when the filter is active; clicking it clears the filter', async () => {
    const narrow = makeNarrow({
      pickedMaps:  ref(new Set(['rialto'])),
      pickedRoles: ref(new Set(['support'])),
    })
    renderBand(narrow)
    const reset = screen.getByTitle('Clear the maps × roles filter this band applied')
    await user().click(reset)
    expect(narrow.pickedMaps.value.size).toBe(0)
    expect(narrow.pickedRoles.value.size).toBe(0)
    // Hides once cleared.
    expect(screen.queryByTitle('Clear the maps × roles filter this band applied')).not.toBeInTheDocument()
  })

  it('selecting a cell highlights it AND live-filters the set (no button)', async () => {
    const narrow = makeNarrow()
    renderBand(narrow)
    const cell = () => screen.getByLabelText(/^Support on Rialto/)
    await press(cell())
    expect(cell()).toHaveAttribute('aria-pressed', 'true')
    expect(selectedCells()).toHaveLength(1)
    // Selecting now narrows immediately — no "Filter to selection" step.
    expect([...narrow.pickedMaps.value]).toEqual(['rialto'])
    expect([...narrow.pickedRoles.value]).toEqual(['support'])
  })

  it('clicking the selected cell again clears it (click off)', async () => {
    renderBand()
    const cell = () => screen.getByLabelText(/^Support on Rialto/)
    await press(cell())
    await press(cell())
    expect(cell()).toHaveAttribute('aria-pressed', 'false')
    expect(emptyPrompt()).toBeInTheDocument() // selection bar gone
  })

  it('clicking another cell replaces the selection — never two highlighted cells', async () => {
    renderBand()
    await press(screen.getByLabelText(/^Support on Rialto/))
    await press(screen.getByLabelText(/^Tank on Ilios/))
    expect(selectedCells()).toHaveLength(1)
    expect(screen.getByLabelText(/^Tank on Ilios/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking a role label selects the whole row', async () => {
    renderBand()
    await user().click(screen.getByLabelText('Select all maps for Support'))
    // The two played support cells (rialto, dorado/ilios are inert for support) light up.
    expect(screen.getByLabelText(/^Support on Rialto/)).toHaveAttribute('aria-pressed', 'true')
    expect(emptyPrompt()).not.toBeInTheDocument() // selection bar shown
  })

  it('clicking a map name selects the whole column', async () => {
    renderBand()
    await user().click(screen.getByLabelText('Select all roles on Rialto'))
    expect(screen.getByLabelText(/^Support on Rialto/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the selected map / role / game-mode headers highlighted', async () => {
    renderBand()
    const rialtoCol = () => screen.getByLabelText('Select all roles on Rialto')
    await user().click(rialtoCol())
    expect(rialtoCol()).toHaveAttribute('aria-pressed', 'true')
    // Narrow to a role within Rialto → the role header lights, Rialto stays lit.
    const supportRow = () => screen.getByLabelText('Select all maps for Support')
    await user().click(supportRow())
    expect(supportRow()).toHaveAttribute('aria-pressed', 'true')
    expect(rialtoCol()).toHaveAttribute('aria-pressed', 'true')
    // A game-mode group header lights when all its maps are selected.
    const escort = screen.getByLabelText('Select all Escort maps')
    await user().click(escort)
    expect(escort).toHaveAttribute('aria-pressed', 'true')
  })

  it('Ctrl-clicking a second cell live-filters to the rectangular hull', async () => {
    const narrow = makeNarrow()
    renderBand(narrow)
    await press(screen.getByLabelText(/^Support on Rialto/))
    await press(screen.getByLabelText(/^Tank on Ilios/), { ctrlKey: true })
    expect(selectedCells()).toHaveLength(2)
    // The narrow tracks the selection's hull (maps × roles) live, no button.
    expect([...narrow.pickedMaps.value].sort()).toEqual(['ilios', 'rialto'])
    expect([...narrow.pickedRoles.value].sort()).toEqual(['support', 'tank'])
  })

  it('shows the combined-stats readout for the selection', async () => {
    renderBand()
    await press(screen.getByLabelText(/^Support on Rialto/))
    // rialto/support = 8-4-0, 67% WR over 12 games
    const stats = screen.getByText(/8–4–0/)
    expect(stats).toHaveTextContent('67% WR')
    expect(stats).toHaveTextContent('12 games')
  })

  it('reserves the readout slot — an empty prompt shows until a cell is selected', async () => {
    renderBand()
    // Nothing selected: the prompt fills the slot, the active bar is absent.
    expect(emptyPrompt()).toBeInTheDocument()
    expect(screen.queryByText(/8–4–0/)).not.toBeInTheDocument()
    // Selecting swaps the prompt for the active bar in the same slot (no shift).
    await press(screen.getByLabelText(/^Support on Rialto/))
    expect(screen.getByText(/8–4–0/)).toBeInTheDocument()
    expect(emptyPrompt()).not.toBeInTheDocument()
  })

  it("clicking a game-mode group header selects that group's columns", async () => {
    renderBand()
    await user().click(screen.getByLabelText('Select all Escort maps'))
    // Escort = Dorado + Rialto; played cells there: dorado|dps + rialto|support.
    expect(selectedCells()).toHaveLength(2)
    expect(emptyPrompt()).not.toBeInTheDocument() // selection bar shown
  })

  it('offers a 1M/3M/6M/12M window toggle defaulting to 6M', () => {
    renderBand()
    const btns = screen.getAllByRole('button', { name: /^\d+M$/ })
    expect(btns.map((b) => b.textContent?.trim())).toEqual(['1M', '3M', '6M', '12M'])
    const active = btns.find((b) => b.getAttribute('aria-pressed') === 'true')
    expect(active).toHaveTextContent('6M')
  })

  it('persists the chosen window and marks it active', async () => {
    renderBand()
    const oneMonth = screen.getByRole('button', { name: '1M' })
    await user().click(oneMonth)
    expect(oneMonth).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('recall.mapRoleWindowMonths')).toBe('1')
  })

  it('hides the row for a role the player has never played', () => {
    // Only tank + support carry matches; DPS has none, so its row drops out.
    const noDps: MapRoleCell[] = [
      { map: 'rialto', role: 'support', wins: 8, losses: 4, draws: 0, total: 12, winrate: 67 },
      { map: 'ilios', role: 'tank', wins: 2, losses: 2, draws: 0, total: 4, winrate: 50 },
    ]
    renderWidget(MatchMapRoleBand, { dossier: { mapRoleCounts: noDps }, narrow: makeNarrow() })
    const rows = rowheads().map((n) => n.textContent?.trim())
    expect(rows).toEqual(['Tank', 'Support'])
    expect(rows).not.toContain('DPS')
  })

  it('prompts to play a match when there are none, instead of an empty grid', () => {
    renderWidget(MatchMapRoleBand, { dossier: { mapRoleCounts: [] }, narrow: makeNarrow() })
    expect(screen.queryByRole('group', { name: /Map × role performance/ })).not.toBeInTheDocument()
    expect(screen.getByText(/at least 1 match must be played to display data/i)).toBeInTheDocument()
  })

  // heatmapCellClass is a THRESHOLD verdict (past the band, under the
  // evidence floor) that used to live in the tint alone — WCAG 1.4.1.
  // The band word is now SPOKEN in the cell's accessible name, from the
  // one shared vocabulary every judged surface reads.
  it('speaks the shared judgment band in each cell name', () => {
    renderWidget(MatchMapRoleBand, {
      dossier: { mapRoleCounts: [
        // 53.3% over 30 decisive — a modest edge with real volume.
        { map: 'rialto', role: 'support', wins: 16, losses: 14, draws: 0, total: 30, winrate: 53 },
        // 26.7% over 30 — the same volume, bleeding.
        { map: 'dorado', role: 'dps', wins: 8, losses: 22, draws: 0, total: 30, winrate: 27 },
      ] },
      narrow: makeNarrow(),
    })
    expect(screen.getByLabelText(/^Support on Rialto/))
      .toHaveAccessibleName('Support on Rialto: 16-14-0 · 53% win rate over 30 games — winning')
    expect(screen.getByLabelText(/^DPS on Dorado/))
      .toHaveAccessibleName('DPS on Dorado: 8-22-0 · 27% win rate over 30 games — losing')
  })

  it('withholds a verdict under the evidence floor instead of claiming one', () => {
    renderWidget(MatchMapRoleBand, {
      dossier: { mapRoleCounts: [
        // 75% over 4 — a heater, still under the 15-decisive floor: the
        // tint stays grey, so the name must not say "winning" either.
        { map: 'ilios', role: 'tank', wins: 3, losses: 1, draws: 0, total: 4, winrate: 75 },
      ] },
      narrow: makeNarrow(),
    })
    const heater = screen.getByLabelText(/^Tank on Ilios/)
    expect(heater).toHaveAccessibleName(/— too few games to judge$/)
    expect(heater).not.toHaveAccessibleName(/winning|losing/)
    // A never-played cell says so and claims nothing.
    expect(screen.getByLabelText(/^Tank on Dorado/)).toHaveAccessibleName('Tank on Dorado: no matches')
  })
})
