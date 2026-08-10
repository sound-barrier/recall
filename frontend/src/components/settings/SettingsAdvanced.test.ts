// SettingsAdvanced — Manage-ignored row + Clear-Database opt-out
// checkbox. The arm/confirm two-step on Clear is covered by
// SettingsView.test.ts; the cases below pin behavior the
// Manage-ignored + re-parse-progress props/emits introduced.

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

// The component reads useUiStore (Replay-tour request), so every render
// needs an active Pinia.
beforeEach(() => setActivePinia(createPinia()))

function renderAdvanced(overrides: Partial<{
  clearConfirm:      boolean
  matchedCount:      number
  unknownCount:      number
  ignoredCount:      number
}> = {}) {
  return render(SettingsAdvanced, {
    props: {
      clearConfirm:      overrides.clearConfirm ?? false,
      matchedCount:      overrides.matchedCount ?? 5,
      unknownCount:      overrides.unknownCount ?? 0,
      ignoredCount:      overrides.ignoredCount ?? 0,
    },
  })
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

  it('Manage button is enabled and emits open-ignored-panel when ignoredCount > 0', async () => {
    const user = userEvent.setup()
    const { emitted } = renderAdvanced({ ignoredCount: 3 })
    const btn = screen.getByRole('button', { name: 'Manage…' })
    expect(btn).toBeEnabled()
    await user.click(btn)
    expect(emitted('open-ignored-panel')).toBeTruthy()
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

  it('Confirm emits clear-database with { keepIgnored: false } by default', async () => {
    const user = userEvent.setup()
    const { emitted } = renderAdvanced({ clearConfirm: true, ignoredCount: 3 })
    await user.click(screen.getByRole('button', { name: 'Delete 5 Records' }))
    expect(emitted('clear-database')).toEqual([[{ keepIgnored: false }]])
  })

  it('Checking the box and confirming emits with { keepIgnored: true }', async () => {
    const user = userEvent.setup()
    const { emitted } = renderAdvanced({ clearConfirm: true, ignoredCount: 3 })
    await user.click(keepIgnoredCheckbox(3))
    await user.click(screen.getByRole('button', { name: 'Delete 5 Records' }))
    expect(emitted('clear-database')).toEqual([[{ keepIgnored: true }]])
  })

  it('Opt-out checkbox resets to false when the arm is re-opened', async () => {
    const user = userEvent.setup()
    const { rerender } = renderAdvanced({ clearConfirm: true, ignoredCount: 3 })
    await user.click(keepIgnoredCheckbox(3))
    expect(keepIgnoredCheckbox(3)).toBeChecked()
    // Simulate the parent toggling clearConfirm off then on again
    // (user clicked Cancel, then re-armed). The checkbox must reset.
    await rerender({ clearConfirm: false })
    await rerender({ clearConfirm: true })
    expect(keepIgnoredCheckbox(3)).not.toBeChecked()
  })
})

describe('SettingsAdvanced — re-parse progress line (item 12)', () => {
  it('renders nothing when parseProgress carries no re-parse counters', () => {
    render(SettingsAdvanced, {
      props: {
        parseProgress: { done: 5, total: 47, filename: 'x.png', screenshot_type: 'teams' },
      },
    })
    expect(screen.queryByText(/matches updated/)).not.toBeInTheDocument()
  })

  it('renders the cumulative counters when the SSE event carries them', () => {
    render(SettingsAdvanced, {
      props: {
        reparsing: true,
        parseProgress: {
          done: 47,
          total: 47,
          filename: 'x.png',
          screenshot_type: 'teams',
          matches_updated: 12,
          hero_corrections: 3,
          map_corrections: 1,
        },
      },
    })
    const line = screen.getByText(/12 of 47 matches updated/)
    expect(line).toHaveTextContent('3 hero / 1 map corrected')
  })

  it('omits the corrections suffix when neither hero nor map fields changed', () => {
    render(SettingsAdvanced, {
      props: {
        reparsing: true,
        parseProgress: {
          done: 47,
          total: 47,
          filename: 'x.png',
          screenshot_type: 'teams',
          matches_updated: 12,
          hero_corrections: 0,
          map_corrections: 0,
        },
      },
    })
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
    const { emitted } = renderAdvanced({ ignoredCount: 2 })
    const manage = screen.getByRole('button', { name: 'Manage…' })

    await user.click(manage)
    expect(emitted('open-ignored-panel')).toHaveLength(1)

    manage.focus()
    // happy-dom's activeElement fails identity compares (see
    // frontend/CLAUDE.md), so assert focus via textContent.
    expect(document.activeElement?.textContent?.trim()).toBe('Manage…')
    await user.keyboard('{Enter}')
    expect(emitted('open-ignored-panel')).toHaveLength(2)

    await user.tab()
    expect(document.activeElement?.textContent?.trim()).not.toBe('Manage…')
    // eslint-disable-next-line testing-library/no-node-access -- focus traversal IS the behavior under test; TL has no focus query
    expect(document.activeElement).not.toBe(document.body)
  })
})
