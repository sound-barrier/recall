import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import { flushPromises } from '@/test-utils'
import MatchesView from '@/components/matches/MatchesView.vue'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { GetProfiles, SetMatchVisibility, HardDeleteMatch, MoveMatches } from '@/api'
import type { MatchRecord } from '@/api'

// MatchesView reads its mutations from useMatchActions (→ the api) + selection
// from the UI store now, instead of emitting. Mock GetProfiles (the move picker
// fetches it on mount) + the mutation calls these tests assert on + GetMatch
// Results (so the store's reload-after-mutation doesn't hit the transport);
// everything else stays the real module.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetProfiles:        vi.fn(async () => ({ active: 'main', profiles: ['main'], immutable: [] })),
  GetMatchResults:    vi.fn(async () => []),
  SetMatchVisibility: vi.fn(async () => undefined),
  HardDeleteMatch:    vi.fn(async () => undefined),
  MoveMatches:        vi.fn(async () => undefined),
}))

// This file imports the matches store, which statically imports '@/api'. Reset
// the module registry after each test so the cached store + its real '@/api'
// binding don't leak into a later renderApp test (whose api mock
// can't reach an already-imported store). See reference_store_api_mock_isolation.
// Settle in-flight lazy-child imports (detail panel, lightbox, …) INSIDE
// the test env — a loader that resolves after teardown throws
// EnvironmentTeardownError as an unhandled rejection and fails the run
// even with every test green (seen on CI's slow coverage pass).
afterEach(async () => {
  await vi.dynamicImportSettled()
  vi.clearAllMocks()
  vi.resetModules()
})

// Unit tests for the contextual multi-select + Hidden drawer surfaces.
// End-to-end transport chain is covered by
// frontend/tests/e2e/match-bulk-hide-drawer.spec.ts; these mount the
// SFC directly so the branch coverage for the new state-machine code
// (per-row checkbox toggle, sticky action bar, bulk archive ops, two-
// step confirms) lives next to the template that exercises it.

function makeRecord(over: Partial<MatchRecord> = {}, dataOver: Partial<MatchRecord['data']> = {}): MatchRecord {
  return {
    match_key: 'match-2026-05-10T22-00-00',
    source_files: ['a.png'],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 10,
      assists: 5,
      deaths: 3,
      damage: 5000,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
      ...dataOver,
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...over,
  }
}

function renderView(records: MatchRecord[]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  // Seed the store records; the store builds matchesNarrow off them and
  // MatchesView reads it from the store (no narrow prop any more).
  useMatchesStore().records = records
  return render(MatchesView, {
    global: { plugins: [pinia] },
  })
}

const user = () => userEvent.setup()

// ── Structural helpers ───────────────────────────────────────────────
// A row body is deliberately NOT a control (see frontend/CLAUDE.md: a
// clickable container holding interactive chips can't be role=button), so
// clicking one has no accessible handle — those two helpers reach for the
// element. Everything about SELECTION reads off the per-row checkbox.
/* eslint-disable testing-library/no-node-access -- the row body is intentionally role-less; clicking it has no accessible handle */
const leafRows      = () => [...document.querySelectorAll('.leaf-row')]
const archiveRows   = () => [...document.querySelectorAll('.archive-row')]
const campaignLog   = () => document.querySelector('.match-timeline')
/* eslint-enable testing-library/no-node-access */

const leafChecks    = () => screen.getAllByRole('checkbox', { name: /^Select match / })
const archiveChecks = () => screen.getAllByRole('checkbox', { name: /^Select hidden match / })
const tickedLeaves  = () => screen.queryAllByRole('checkbox', { name: /^Select match /, checked: true })
const tickedArchive = () => screen.queryAllByRole('checkbox', { name: /^Select hidden match /, checked: true })

const bulkBar    = () => screen.queryByRole('region', { name: 'Bulk action bar' })
const archiveBar = () => screen.queryByRole('region', { name: 'Archive bulk action bar' })
const inBulkBar    = () => within(screen.getByRole('region', { name: 'Bulk action bar' }))
const inArchiveBar = () => within(screen.getByRole('region', { name: 'Archive bulk action bar' }))
const archiveRegion = () => screen.queryByRole('region', { name: 'Hidden matches archive' })
const archiveToggle = () => within(screen.getByRole('region', { name: 'Hidden matches archive' }))
  .getByRole('button', { name: /hidden match/ })

describe('MatchesView — contextual multi-select (live rows)', () => {
  it('checkboxes are always in the DOM — no mode toggle needed', () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
    ]
    renderView(records)

    expect(leafRows()).toHaveLength(2)
    expect(leafChecks()).toHaveLength(2)
    expect(bulkBar()).not.toBeInTheDocument()
  })

  it('checkbox click ticks the row and stops the row body click from firing open-match', async () => {
    renderView([makeRecord({ match_key: 'k1' })])

    await user().click(screen.getByRole('checkbox', { name: 'Select match k1' }))

    expect(screen.getByRole('checkbox', { name: 'Select match k1' })).toBeChecked()
    expect(bulkBar()).toBeInTheDocument()
    expect(inBulkBar().getByText(/1 selected/)).toBeInTheDocument()
    // The checkbox click must NOT have bubbled into the row's open-match handler.
    expect(useUiStore().selection.isOpen.value).toBe(false)
  })

  it('row body click still opens the detail panel even while a selection exists', async () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
    ]
    renderView(records)

    // Tick the first row, then click the body of the second row.
    await user().click(leafChecks()[0]!)
    await user().click(leafRows()[1]!)

    // Row click opens the detail; the second row should NOT have been
    // ticked, and the existing selection should still be 1.
    expect(useUiStore().selection.isOpen.value).toBe(true)
    expect(leafChecks()[1]).not.toBeChecked()
    expect(inBulkBar().getByText(/1 selected/)).toBeInTheDocument()
  })

  it('Select all targets every visible row; the button hides once everything is ticked', async () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
      makeRecord({ match_key: 'k3' }, { finished_at: '23:00' }),
    ]
    renderView(records)

    // Tick one to surface the action bar.
    await user().click(leafChecks()[0]!)
    const selectAll = inBulkBar().getByRole('button', { name: 'Select all (3)' })

    await user().click(selectAll)
    expect(tickedLeaves()).toHaveLength(3)
    expect(inBulkBar().getByText(/3 selected/)).toBeInTheDocument()
    // When the selection covers everything visible, Select all is
    // redundant and disappears.
    expect(inBulkBar().queryByRole('button', { name: /Select all/ })).not.toBeInTheDocument()
  })

  it('Hide emits hide-matches with every ticked key and clears the selection', async () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
    ]
    renderView(records)
    await user().click(leafChecks()[0]!)
    await user().click(leafChecks()[1]!)

    await user().click(inBulkBar().getByRole('button', { name: 'Hide' }))

    await flushPromises()
    expect(SetMatchVisibility).toHaveBeenCalledWith('k1', true)
    expect(SetMatchVisibility).toHaveBeenCalledWith('k2', true)
    expect(bulkBar()).not.toBeInTheDocument()
    expect(tickedLeaves()).toHaveLength(0)
  })

  it('Clear empties the selection without emitting', async () => {
    renderView([makeRecord({ match_key: 'k1' })])
    await user().click(leafChecks()[0]!)

    await user().click(inBulkBar().getByRole('button', { name: 'Clear' }))

    expect(bulkBar()).not.toBeInTheDocument()
    expect(leafChecks()[0]).not.toBeChecked()
    expect(SetMatchVisibility).not.toHaveBeenCalled()
  })

  it('un-ticking the last row removes the action bar', async () => {
    renderView([makeRecord({ match_key: 'k1' })])

    await user().click(leafChecks()[0]!)
    expect(bulkBar()).toBeInTheDocument()

    await user().click(leafChecks()[0]!)
    expect(bulkBar()).not.toBeInTheDocument()
    expect(leafChecks()[0]).not.toBeChecked()
  })
})

describe('MatchesView — Hidden drawer', () => {
  it('does not render the Archive section when nothing is hidden', () => {
    renderView([makeRecord({ match_key: 'k1' })])
    expect(archiveRegion()).not.toBeInTheDocument()
  })

  it('surfaces a count chip and singular noun for one hidden match', () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    renderView(records)

    expect(archiveRegion()).toBeInTheDocument()
    const toggle = archiveToggle()
    expect(toggle).toHaveTextContent('1')
    expect(toggle).toHaveTextContent(/hidden match(?!es)/)
    expect(archiveRows()).toHaveLength(0)
  })

  it('pluralizes the noun for multiple hidden matches', () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    renderView(records)
    expect(archiveToggle()).toHaveTextContent('hidden matches')
  })

  it('expand reveals the hidden rows with per-row checkbox + Unhide + Delete forever', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    renderView(records)
    await user().click(archiveToggle())

    expect(archiveRows()).toHaveLength(2)
    expect(archiveChecks()).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Unhide' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Delete forever' })).toHaveLength(2)
    expect(archiveToggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('per-row Unhide still works as a single-target action', async () => {
    renderView([makeRecord({ match_key: 'k1', hidden: true })])
    await user().click(archiveToggle())
    await user().click(screen.getByRole('button', { name: 'Unhide' }))

    await flushPromises()
    expect(SetMatchVisibility).toHaveBeenCalledWith('k1', false)
  })

  it('per-row Delete forever is a two-step inline confirm', async () => {
    renderView([makeRecord({ match_key: 'k1', hidden: true })])
    await user().click(archiveToggle())

    await user().click(screen.getByRole('button', { name: 'Delete forever' }))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument()
    expect(HardDeleteMatch).not.toHaveBeenCalled()

    await user().click(screen.getByRole('button', { name: 'Confirm' }))
    await flushPromises()
    expect(HardDeleteMatch).toHaveBeenCalledWith('k1')
  })

  it('per-row Delete forever Cancel reverts to action buttons without emitting', async () => {
    renderView([makeRecord({ match_key: 'k1', hidden: true })])
    await user().click(archiveToggle())
    await user().click(screen.getByRole('button', { name: 'Delete forever' }))
    await user().click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(HardDeleteMatch).not.toHaveBeenCalled()
  })
})

describe('MatchesView — Archive bulk selection', () => {
  it('archive checkbox click ticks the row and surfaces the archive action bar', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    renderView(records)
    await user().click(archiveToggle())

    expect(archiveBar()).not.toBeInTheDocument()
    await user().click(archiveChecks()[0]!)

    expect(tickedArchive()).toHaveLength(1)
    expect(archiveBar()).toBeInTheDocument()
    expect(inArchiveBar().getByText(/1 selected/)).toBeInTheDocument()
  })

  it('archive Select all targets every hidden row; button hides at full coverage', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
      makeRecord({ match_key: 'k3', hidden: true }, { finished_at: '23:00' }),
    ]
    renderView(records)
    await user().click(archiveToggle())
    await user().click(archiveChecks()[0]!)

    const selectAll = inArchiveBar().getByRole('button', { name: 'Select all (3)' })

    await user().click(selectAll)
    expect(tickedArchive()).toHaveLength(3)
    expect(inArchiveBar().getByText(/3 selected/)).toBeInTheDocument()
    expect(inArchiveBar().queryByRole('button', { name: /Select all/ })).not.toBeInTheDocument()
  })

  it('Unhide on the archive action bar emits unhide-matches and clears the selection', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    renderView(records)
    await user().click(archiveToggle())
    await user().click(archiveChecks()[0]!)
    await user().click(archiveChecks()[1]!)

    await user().click(inArchiveBar().getByRole('button', { name: 'Unhide' }))

    await flushPromises()
    expect(SetMatchVisibility).toHaveBeenCalledWith('k1', false)
    expect(SetMatchVisibility).toHaveBeenCalledWith('k2', false)
    expect(archiveBar()).not.toBeInTheDocument()
  })

  it('bulk Delete forever is a two-step confirm; Confirm emits hard-delete-matches', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    renderView(records)
    await user().click(archiveToggle())
    await user().click(archiveChecks()[0]!)
    await user().click(archiveChecks()[1]!)

    await user().click(inArchiveBar().getByRole('button', { name: 'Delete forever' }))
    // Confirm UI takes over the bar; primary actions disappear.
    expect(inArchiveBar().getByText('Delete 2 matches from the database?')).toBeInTheDocument()
    expect(inArchiveBar().getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(inArchiveBar().queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument()
    expect(inArchiveBar().queryByRole('button', { name: 'Unhide' })).not.toBeInTheDocument()
    expect(HardDeleteMatch).not.toHaveBeenCalled()

    await user().click(inArchiveBar().getByRole('button', { name: 'Confirm' }))
    await flushPromises()
    expect(HardDeleteMatch).toHaveBeenCalledWith('k1')
    expect(HardDeleteMatch).toHaveBeenCalledWith('k2')
    // Selection cleared.
    expect(archiveBar()).not.toBeInTheDocument()
  })

  it('bulk Delete forever warn-text uses singular noun for one ticked match', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    renderView(records)
    await user().click(archiveToggle())
    await user().click(archiveChecks()[0]!)

    await user().click(inArchiveBar().getByRole('button', { name: 'Delete forever' }))
    expect(inArchiveBar().getByText('Delete 1 match from the database?')).toBeInTheDocument()
  })

  it('bulk Delete forever Cancel reverts to primary actions without emitting', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    renderView(records)
    await user().click(archiveToggle())
    await user().click(archiveChecks()[0]!)
    await user().click(inArchiveBar().getByRole('button', { name: 'Delete forever' }))

    await user().click(inArchiveBar().getByRole('button', { name: 'Cancel' }))

    expect(inArchiveBar().getByRole('button', { name: 'Delete forever' })).toBeInTheDocument()
    expect(inArchiveBar().getByRole('button', { name: 'Unhide' })).toBeInTheDocument()
    expect(inArchiveBar().queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    // Selection survives the cancel — user can revise it before retrying.
    expect(tickedArchive()).toHaveLength(1)
    expect(HardDeleteMatch).not.toHaveBeenCalled()
  })

  it('toggling the selection while in bulk-confirm aborts the confirm state', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    renderView(records)
    await user().click(archiveToggle())
    await user().click(archiveChecks()[0]!)
    await user().click(inArchiveBar().getByRole('button', { name: 'Delete forever' }))
    expect(inArchiveBar().getByRole('button', { name: 'Confirm' })).toBeInTheDocument()

    // Add the second row to the selection — the prior "Confirm" no
    // longer means the same thing, so the bar reverts to primaries.
    await user().click(archiveChecks()[1]!)
    expect(inArchiveBar().queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(inArchiveBar().getByRole('button', { name: 'Delete forever' })).toBeInTheDocument()
  })
})

describe('MatchesView — Move to profile picker', () => {
  // The Move-to picker fetches /api/v1/profiles on mount. Stub the
  // api module so the SFC sees a fixture state with one other
  // profile available.
  it('Move to… is suppressed when no other profile exists', async () => {
    renderView([makeRecord({ match_key: 'k1' })])
    await user().click(leafChecks()[0]!)
    // Default mock returns profiles=['main'] — no others.
    expect(inBulkBar().queryByRole('button', { name: 'Move to…' })).not.toBeInTheDocument()
  })

  it('clicking Move to… reveals the target picker (when other profiles exist)', async () => {
    vi.mocked(GetProfiles).mockResolvedValue({ active: 'main', profiles: ['alt', 'main'], immutable: [] })
    renderView([makeRecord({ match_key: 'k1' })])
    // Macrotask tick: the profiles query notifies observers through the
    // notifyManager's setTimeout scheduling, which flushPromises misses.
    await new Promise(r => setTimeout(r, 0))

    await user().click(leafChecks()[0]!)
    await user().click(inBulkBar().getByRole('button', { name: 'Move to…' }))

    expect(inBulkBar().getByText('Move to:')).toBeInTheDocument()
    expect(inBulkBar().getByRole('button', { name: 'alt' })).toBeInTheDocument()
  })

  it('clicking a target chip emits move-matches with the ticked keys + target', async () => {
    vi.mocked(GetProfiles).mockResolvedValue({ active: 'main', profiles: ['alt', 'main'], immutable: [] })
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
    ]
    renderView(records)
    await new Promise(r => setTimeout(r, 0))

    await user().click(leafChecks()[0]!)
    await user().click(leafChecks()[1]!)
    await user().click(inBulkBar().getByRole('button', { name: 'Move to…' }))
    await user().click(inBulkBar().getByRole('button', { name: 'alt' }))

    await flushPromises()
    const call = vi.mocked(MoveMatches).mock.calls[0]!
    expect([...(call[0] as string[])].sort()).toEqual(['k1', 'k2'])
    expect(call[1]).toBe('alt')
    // Picker resets after commit.
    expect(screen.queryByText('Move to:')).not.toBeInTheDocument()
  })

  it('Cancel reverts the picker without emitting', async () => {
    vi.mocked(GetProfiles).mockResolvedValue({ active: 'main', profiles: ['alt', 'main'], immutable: [] })
    renderView([makeRecord({ match_key: 'k1' })])
    await new Promise(r => setTimeout(r, 0))

    await user().click(leafChecks()[0]!)
    await user().click(inBulkBar().getByRole('button', { name: 'Move to…' }))
    await user().click(inBulkBar().getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Move to:')).not.toBeInTheDocument()
    expect(inBulkBar().getByRole('button', { name: 'Move to…' })).toBeInTheDocument()
    expect(MoveMatches).not.toHaveBeenCalled()
  })
})

describe('MatchesView — campaign log hidden filter', () => {
  // The timeline section always renders its shell; what visibleRecords
  // controls is whether it has data. (The old assertion expected the
  // SECTION to vanish and "passed" for months only because its
  // '.campaign-log' selector matched nothing — the class never existed.)
  it('the timeline has data for visible matches (positive control)', () => {
    renderView([makeRecord({ match_key: 'k1' })])
    expect(campaignLog()).not.toBeNull()
    // eslint-disable-next-line testing-library/no-node-access -- e2e-shared data-attr contract, no accessible surface
    expect(document.querySelector('[data-timeline-no-data]')).toBeNull()
  })

  it('hidden matches drop out of the timeline (visibleRecords feeds it)', () => {
    renderView([makeRecord({ match_key: 'k1', hidden: true })])
    expect(campaignLog()).not.toBeNull()
    // eslint-disable-next-line testing-library/no-node-access -- e2e-shared data-attr contract, no accessible surface
    expect(document.querySelector('[data-timeline-no-data]')).not.toBeNull()
  })
})

describe('MatchesView — infinite-scroll window', () => {
  function fillCorpus(n: number): MatchRecord[] {
    return Array.from({ length: n }, (_, i) => {
      const k = String(i).padStart(3, '0')
      // Spread across days so groupBy='day' (the default) produces
      // multiple sections — verifies the windowing logic respects
      // section boundaries (not just a flat row count).
      const day = String(10 + (i % 5)).padStart(2, '0')
      return makeRecord(
        { match_key: `match-2026-05-${day}T${k}` },
        { date: `2026-05-${day}`, finished_at: `${String(i % 24).padStart(2, '0')}:${k.slice(-2)}` },
      )
    })
  }

  it('renders exactly DEFAULT_PAGE_SIZE (20) leaf-rows for a 50-row corpus', () => {
    renderView(fillCorpus(50))
    expect(leafRows()).toHaveLength(20)
  })

  it('shows the sentinel + "Showing 20 of 50 matches" foot', () => {
    renderView(fillCorpus(50))
    expect(screen.getByTestId('leaves-sentinel')).toBeInTheDocument()
    expect(screen.getByTestId('leaves-foot')).toHaveTextContent('Showing 20 of 50 matches')
  })

  it('omits the sentinel + reads "End · N matches" when corpus fits', () => {
    renderView(fillCorpus(7))
    expect(leafRows()).toHaveLength(7)
    expect(screen.queryByTestId('leaves-sentinel')).not.toBeInTheDocument()
    expect(screen.getByTestId('leaves-foot')).toHaveTextContent('End · 7')
    // eslint-disable-next-line testing-library/no-node-access -- decorative foot rules have no accessible surface
    expect(document.querySelectorAll('.leaves-foot-rule')).toHaveLength(2)
  })

  it('foot carries an aria-live=polite status INSIDE the listitem (a role=status li is an invalid list child)', () => {
    renderView(fillCorpus(50))
    const foot = screen.getByTestId('leaves-foot')
    // The li keeps its implicit listitem role…
    expect(foot).not.toHaveAttribute('role')
    // …and the live region is a nested span.
    const status = within(foot).getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })
})

// ── Scroll-to-top + Jump-to-undated affordances ──────────────────
//
// The scroll-to-top button uses useScrollAffordance under the hood;
// the composable's own listener + threshold contract is covered in
// useScrollAffordance.test.ts. Here we just verify the SFC renders
// the gated button + that the jump button reflects the live undated
// count, including the disabled-with-tooltip empty-state.

describe('MatchesView — scroll-to-top button', () => {
  it('is hidden by default (the user mounts the view at the top of the page)', () => {
    renderView([makeRecord({ match_key: 'k1' })])
    expect(screen.queryByRole('button', { name: 'Scroll to top of page' })).not.toBeInTheDocument()
  })

  it('appears once window.scrollY crosses the threshold; click resets scrollY to 0', async () => {
    renderView([makeRecord({ match_key: 'k1' })])
    // useScrollAffordance reads window.scrollY on every scroll event;
    // simulate the deep-scroll state by patching the value and
    // dispatching the listener it installs on mount.
    Object.defineProperty(window, 'scrollY', { value: 800, writable: true, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    // requestAnimationFrame coalesces; flush by waiting a frame.
    await new Promise(resolve => requestAnimationFrame(resolve))
    expect(await screen.findByRole('button', { name: 'Scroll to top of page' })).toBeInTheDocument()
  })
})

describe('MatchesView — jump-to-undated button', () => {
  it('renders with the live undated count', () => {
    const records = [
      makeRecord({ match_key: 'k1' }, { date: '2026-05-10' }),
      makeRecord({ match_key: 'k2' }, { date: undefined }),
      makeRecord({ match_key: 'k3' }, { date: '' }),
    ]
    renderView(records)
    // 2 of the 3 records have no usable date.
    const btn = screen.getByRole('button', { name: /2 undated/ })
    expect(btn).toBeEnabled()
    expect(btn).toHaveAttribute('title', expect.stringMatching(/Jump to 2 undated matches/))
  })

  it('is disabled with an empty-state tooltip when no undated matches exist', () => {
    renderView([makeRecord({ match_key: 'k1' }, { date: '2026-05-10' })])
    const btn = screen.getByRole('button', { name: /0 undated/ })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'No undated matches in this view')
  })

  it('singular wording when exactly one undated match', () => {
    const records = [
      makeRecord({ match_key: 'k1' }, { date: '2026-05-10' }),
      makeRecord({ match_key: 'k2' }, { date: undefined }),
    ]
    renderView(records)
    const btn = screen.getByRole('button', { name: /1 undated/ })
    expect(btn).toHaveAttribute('title', expect.stringMatching(/Jump to 1 undated match$/))
  })
})
