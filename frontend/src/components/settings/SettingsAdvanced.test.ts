// SettingsAdvanced — Manage-ignored row + Clear-Database opt-out
// checkbox. The arm/confirm two-step on Clear is covered by
// SettingsView.test.ts; the cases below pin behavior the
// Manage-ignored + re-parse-progress props/emits introduced.

import { nextTick } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Mock ../api so the useOWData session-singleton fetch (added when
// the Supported capture-source rules collapsible landed) doesn't
// try to reach localhost:3000 at module-load time. Returning a
// stub matches the real GetOWData shape so useOWData populates
// data.value with the empty defaults.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  EventsOn:       vi.fn(),
  EventsOff:      vi.fn(),
  GetActiveParse: vi.fn(async () => ({ running: false, done: 0, total: 0, scope: '' })),
  GetOWData: vi.fn(async () => ({
    heroes_by_role:     {},
    maps_by_type:       {},
    screenshot_sources: [],
  })),
}))

import SettingsAdvanced from '@/components/settings/SettingsAdvanced.vue'
import { useUiStore } from '@/stores/ui'
import { useDatabaseStore } from '@/stores/database'
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'
import type { MatchRecord } from '@/api-client'

// Every render needs an active Pinia: the section reads the stores it
// renders rather than taking a bundle of props from a parent shim
// (TECHNICAL_DEBT.md section 15).
beforeEach(() => setActivePinia(createPinia()))

// A record counts as "unknown" when it has no map and is not ambiguous, so a
// matched one needs a map — otherwise every seeded record lands in both totals
// and the Clear button offers to delete twice what was seeded.
function seedRecords(matched: number, unknown = 0): MatchRecord[] {
  const recs: MatchRecord[] = []
  for (let i = 0; i < matched; i++) {
    recs.push({ match_key: `m-${i}`, source_files: [], data: { map: 'rialto', date: '2026-05-10' } } as unknown as MatchRecord)
  }
  for (let i = 0; i < unknown; i++) {
    recs.push({ match_key: `u-${i}`, source_files: [`u-${i}.png`], data: {} } as unknown as MatchRecord)
  }
  return recs
}

function renderAdvanced(overrides: Partial<{
  clearConfirm:      boolean
  matchedCount:      number
  unknownCount:      number
  ignoredCount:      number
}> = {}) {
  const database = useDatabaseStore()
  const matches = useMatchesStore()
  const parse = useParseStore()

  if (overrides.clearConfirm) database.armClear()
  matches.records = seedRecords(overrides.matchedCount ?? 5, overrides.unknownCount ?? 0)
  parse.ignoredScreenshots = Array.from({ length: overrides.ignoredCount ?? 0 }, (_, i) => ({
    filename: `ig-${i}.png`, ignored_at: '2026-05-10T00:00:00Z',
  }))
  const spies = {
    openIgnoredPanel: vi.spyOn(parse, 'openIgnoredPanel'),
    onClearDatabase:  vi.spyOn(database, 'onClearDatabase').mockResolvedValue(undefined),
  }
  return { ...render(SettingsAdvanced), spies }
}

const keepIgnoredCheckbox = (count: number) =>
  screen.getByRole('checkbox', {
    name: `Keep the ${count} ignored screenshot${count === 1 ? '' : 's'} so I don't have to re-triage them.`,
  })

describe('SettingsAdvanced — Manage ignored row', () => {
  it('Manage button is disabled when ignoredCount is 0', () => {
    renderAdvanced({ ignoredCount: 0 })
    expect(screen.getByRole('button', { name: 'Manage…' })).toBeDisabled()
  })

  it('Manage button is enabled and opens the ignored panel when ignoredCount > 0', async () => {
    const user = userEvent.setup()
    const { spies } = renderAdvanced({ ignoredCount: 3 })
    const btn = screen.getByRole('button', { name: 'Manage…' })
    expect(btn).toBeEnabled()
    await user.click(btn)
    expect(spies.openIgnoredPanel).toHaveBeenCalled()
  })

  it('Description reads "haven\'t deleted any" when ignoredCount is 0', () => {
    renderAdvanced({ ignoredCount: 0 })
    expect(screen.getByText(/haven't deleted any screenshots forever yet/)).toBeInTheDocument()
  })

  it('Description reads "N file(s) currently skipped" when ignoredCount > 0', () => {
    renderAdvanced({ ignoredCount: 7 })
    expect(screen.getByText(/7 files currently skipped/)).toBeInTheDocument()
  })
})

describe('SettingsAdvanced — Clear Database opt-out checkbox', () => {
  it('Opt-out checkbox is HIDDEN when clearConfirm is true but ignoredCount is 0', () => {
    renderAdvanced({ clearConfirm: true, ignoredCount: 0 })
    expect(screen.queryByRole('checkbox', { name: /Keep the/ })).not.toBeInTheDocument()
  })

  it('Opt-out checkbox renders in the arm step when ignoredCount > 0', () => {
    renderAdvanced({ clearConfirm: true, ignoredCount: 4 })
    expect(keepIgnoredCheckbox(4)).not.toBeChecked() // default unchecked
  })

  it('Singular wording when ignoredCount === 1', () => {
    renderAdvanced({ clearConfirm: true, ignoredCount: 1 })
    // The exact-name match pins the singular form — a stray plural 's'
    // would change the accessible name and fail the lookup.
    expect(keepIgnoredCheckbox(1)).toBeInTheDocument()
  })

  it('Confirm clears the database with { keepIgnored: false } by default', async () => {
    const user = userEvent.setup()
    const { spies } = renderAdvanced({ clearConfirm: true, ignoredCount: 3 })
    await user.click(screen.getByRole('button', { name: 'Delete 5 Records' }))
    expect(spies.onClearDatabase).toHaveBeenCalledWith({ keepIgnored: false })
  })

  it('Checking the box and confirming clears with { keepIgnored: true }', async () => {
    const user = userEvent.setup()
    const { spies } = renderAdvanced({ clearConfirm: true, ignoredCount: 3 })
    await user.click(keepIgnoredCheckbox(3))
    await user.click(screen.getByRole('button', { name: 'Delete 5 Records' }))
    expect(spies.onClearDatabase).toHaveBeenCalledWith({ keepIgnored: true })
  })

  it('Opt-out checkbox resets to false when the arm is re-opened', async () => {
    const user = userEvent.setup()
    renderAdvanced({ clearConfirm: true, ignoredCount: 3 })
    await user.click(keepIgnoredCheckbox(3))
    expect(keepIgnoredCheckbox(3)).toBeChecked()

    // Cancel, then re-arm — the two clicks a user actually makes, rather than
    // a parent re-rendering the section with a different prop.
    const database = useDatabaseStore()
    database.cancelClear()
    await nextTick()
    database.armClear()
    await nextTick()

    expect(keepIgnoredCheckbox(3)).not.toBeChecked()
  })
})

// The progress line reads the parse store now, so these seed it rather than
// handing the component a prop bundle.
function renderWithProgress(parseProgress: unknown, reparsing = false) {
  const parse = useParseStore()
  parse.parseProgress = parseProgress as never
  parse.parseBusy = reparsing
  return render(SettingsAdvanced)
}

describe('SettingsAdvanced — re-parse progress line (item 12)', () => {
  it('renders nothing when parseProgress carries no re-parse counters', () => {
    renderWithProgress({ done: 5, total: 47, filename: 'x.png', screenshot_type: 'teams' })
    expect(screen.queryByText(/matches updated/)).not.toBeInTheDocument()
  })

  it('renders the cumulative counters when the SSE event carries them', () => {
    renderWithProgress({   done: 47,   total: 47,   filename: 'x.png',   screenshot_type: 'teams',   matches_updated: 12,   hero_corrections: 3,   map_corrections: 1, }, true)
    const line = screen.getByText(/12 of 47 matches updated/)
    expect(line).toHaveTextContent('3 hero / 1 map corrected')
  })

  it('omits the corrections suffix when neither hero nor map fields changed', () => {
    renderWithProgress({   done: 47,   total: 47,   filename: 'x.png',   screenshot_type: 'teams',   matches_updated: 12,   hero_corrections: 0,   map_corrections: 0, }, true)
    const line = screen.getByText(/12 of 47 matches updated/)
    expect(line).not.toHaveTextContent('corrected')
  })
})

describe('SettingsAdvanced — replay onboarding tour', () => {
  it('the Replay button raises the ui-store request (the Done-step promise)', async () => {
    const user = userEvent.setup()
    renderAdvanced()
    const ui = useUiStore()
    expect(ui.tourReplayRequested).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Replay tour' }))
    expect(ui.tourReplayRequested).toBe(true)
  })
})

describe('user-event on happy-dom (migration smoke)', () => {
  // Pins that the three user-event primitives the migrated suite leans
  // on — click, keyboard activation, tab traversal — drive real
  // interactions under happy-dom, not just jsdom. If this ever breaks
  // on an environment bump, fall back to Testing Library's fireEvent
  // in the affected tests.
  it('click, Enter activation, and tab traversal all reach the component', async () => {
    const user = userEvent.setup()
    const { spies } = renderAdvanced({ ignoredCount: 2 })
    const manage = screen.getByRole('button', { name: 'Manage…' })

    await user.click(manage)
    expect(spies.openIgnoredPanel).toHaveBeenCalledTimes(1)

    manage.focus()
    // happy-dom's activeElement fails identity compares (see
    // frontend/CLAUDE.md), so assert focus via textContent.
    expect(document.activeElement?.textContent?.trim()).toBe('Manage…')
    await user.keyboard('{Enter}')
    expect(spies.openIgnoredPanel).toHaveBeenCalledTimes(2)

    await user.tab()
    expect(document.activeElement?.textContent?.trim()).not.toBe('Manage…')
    // eslint-disable-next-line testing-library/no-node-access -- focus traversal IS the behavior under test; TL has no focus query
    expect(document.activeElement).not.toBe(document.body)
  })
})
