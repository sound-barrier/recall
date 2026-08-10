import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import MapRoleConfigPopover from '@/components/matches/manual/MapRoleConfigPopover.vue'
import {
  MAP_ROLE_CONFIG_KEY,
  _resetMapRoleConfigForTest,
  type MapRoleConfig,
} from '@/composables/matches/useMapRoleConfig'
import type { OWData } from '@/api-client'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// A roster with one game mode the canonical order doesn't know ('assault',
// retired from live OW) so the type row's fallback ordering is exercised, and
// maps deliberately out of alphabetical order in the payload.
const ROSTER = {
  heroes_by_role: {},
  maps_by_game_mode: {
    escort: ['Rialto', 'Dorado'],
    assault: ['Hanamura'],
    control: ['Ilios'],
  },
  screenshot_sources: [],
  seasons: [],
} as unknown as OWData

// The popover teleports to <body>, so every query goes through `screen`.
const dialog = () => screen.queryByRole('dialog', { name: 'Geography filters' })
const pill = (name: string) => screen.getByRole('button', { name })
const mapOption = (name: string) => screen.getByRole('option', { name })
const mapNames = () => within(screen.getByRole('listbox')).queryAllByRole('option').map((o) => o.textContent?.trim())
const typeNames = () =>
  within(screen.getByRole('region', { name: 'Map types' })).getAllByRole('button').map((b) => b.textContent?.trim())

// happy-dom leaves globalThis.localStorage undefined without Node's
// --localstorage-file flag; the shared harness stubs its own, and a leaf
// render() like this one has to bring one too (usePersistedRef swallows the
// absence and would silently never persist).
let storage: Record<string, string> = {}
function stubLocalStorage() {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v },
    removeItem: (k: string) => { delete storage[k] },
    clear: () => { storage = {} },
    key: (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })
}

const stored = (): MapRoleConfig | null => {
  const raw = storage[MAP_ROLE_CONFIG_KEY]
  return raw === undefined ? null : (JSON.parse(raw) as MapRoleConfig)
}

function renderPopover(seed?: MapRoleConfig, open = true) {
  if (seed) storage[MAP_ROLE_CONFIG_KEY] = JSON.stringify(seed)
  seedQuery(qk.system.referenceData, ROSTER)
  return render(MapRoleConfigPopover, { props: { open, anchor: new DOMRect(400, 100, 24, 24) } })
}

const user = () => userEvent.setup()

beforeEach(() => {
  stubLocalStorage()
  _resetMapRoleConfigForTest()
})
afterEach(() => {
  _resetMapRoleConfigForTest()
  vi.unstubAllGlobals()
})

describe('MapRoleConfigPopover', () => {
  it('renders nothing while closed', () => {
    renderPopover(undefined, false)
    expect(dialog()).not.toBeInTheDocument()
  })

  it('offers the live roster: canonical type order with unknown modes last, maps alphabetized', () => {
    renderPopover()
    expect(dialog()).toBeInTheDocument()
    // control → escort come from GAME_MODE_ORDER; 'assault' isn't in it and
    // sorts to the end rather than disappearing or leading.
    expect(typeNames()).toEqual(['Control', 'Escort', 'assault'])
    // Alphabetical across ALL modes — the list is one flat roster.
    expect(mapNames()).toEqual(['Dorado', 'Hanamura', 'Ilios', 'Rialto'])
  })

  it('toggles a role on and back off, carrying the state in aria-pressed and localStorage', async () => {
    renderPopover()
    await user().click(pill('Support'))
    expect(pill('Support')).toHaveAttribute('aria-pressed', 'true')
    expect(stored()?.roles).toEqual(['support'])

    await user().click(pill('Support'))
    expect(pill('Support')).toHaveAttribute('aria-pressed', 'false')
    expect(stored()?.roles).toEqual([])
  })

  it('accumulates map picks and shows the running count only once something is picked', async () => {
    renderPopover()
    const count = () => within(screen.getByRole('region', { name: 'Maps' })).queryByText(/^\d+$/)
    expect(count()).not.toBeInTheDocument()

    await user().click(mapOption('Dorado'))
    expect(mapOption('Dorado')).toHaveAttribute('aria-selected', 'true')
    expect(count()).toHaveTextContent('1')

    await user().click(mapOption('Rialto'))
    expect(count()).toHaveTextContent('2')
    expect(stored()?.maps).toEqual(['Dorado', 'Rialto'])

    // Un-picking the last one takes the badge away again.
    await user().click(mapOption('Dorado'))
    await user().click(mapOption('Rialto'))
    expect(count()).not.toBeInTheDocument()
  })

  it('hydrates the pressed/selected state from a persisted config', () => {
    renderPopover({ roles: ['tank'], gameModes: ['control'], maps: ['Ilios'] })
    expect(pill('Tank')).toHaveAttribute('aria-pressed', 'true')
    expect(pill('DPS')).toHaveAttribute('aria-pressed', 'false')
    expect(pill('Control')).toHaveAttribute('aria-pressed', 'true')
    expect(mapOption('Ilios')).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps Reset disabled at default and clears all three groups when used', async () => {
    renderPopover()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()

    await user().click(pill('Tank'))
    await user().click(pill('Control'))
    await user().click(mapOption('Ilios'))
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled()

    await user().click(screen.getByRole('button', { name: 'Reset' }))
    expect(pill('Tank')).toHaveAttribute('aria-pressed', 'false')
    expect(pill('Control')).toHaveAttribute('aria-pressed', 'false')
    expect(mapOption('Ilios')).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('filters the map list as you search, down to an explicit empty state', async () => {
    renderPopover()
    const search = screen.getByRole('searchbox', { name: 'Search maps' })

    // Substring, not prefix — 'ado' finds Dorado.
    await fireEvent.update(search, 'ado')
    expect(mapNames()).toEqual(['Dorado'])

    await fireEvent.update(search, 'zzz')
    expect(mapNames()).toEqual([])
    expect(screen.getByText('No maps match.')).toBeInTheDocument()

    await fireEvent.update(search, '  ')
    expect(mapNames()).toHaveLength(4)
  })

  it('keeps a map picked while the search hides it', async () => {
    renderPopover()
    await user().click(mapOption('Rialto'))
    await fireEvent.update(screen.getByRole('searchbox', { name: 'Search maps' }), 'ilios')
    expect(screen.queryByRole('option', { name: 'Rialto' })).not.toBeInTheDocument()
    // The filter is a view over the roster; the pick survives it.
    expect(stored()?.maps).toEqual(['Rialto'])
  })

  it('closes on a pointerdown outside, but not on one inside or on the gear that opened it', async () => {
    const view = renderPopover()
    const trigger = document.createElement('button')
    trigger.setAttribute('data-mr-config-trigger', '')
    document.body.append(trigger)

    await fireEvent.pointerDown(pill('Tank'))
    expect(view.emitted('close')).toBeUndefined()

    await fireEvent.pointerDown(trigger)
    expect(view.emitted('close')).toBeUndefined()

    await fireEvent.pointerDown(document.body)
    expect(view.emitted('close')).toHaveLength(1)
    trigger.remove()
  })

  it('closes on Escape', async () => {
    const view = renderPopover()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.emitted('close')).toHaveLength(1)
  })

  it('drops its document listener on unmount so a later click cannot reach it', async () => {
    const view = renderPopover()
    view.unmount()
    await fireEvent.pointerDown(document.body)
    expect(view.emitted('close')).toBeUndefined()
  })
})
