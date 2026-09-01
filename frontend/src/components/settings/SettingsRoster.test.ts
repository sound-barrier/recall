import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'

import type { RosterMember } from '@/api'
import SettingsRoster from '@/components/settings/SettingsRoster.vue'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import { setApiBacking } from '@/api-client'
import { flushPromises } from '@/test-utils'

// The roster section is a list plus an add form. Its render branches are
// about being clear that this is a LOOKUP: removing somebody stops showing
// their name, and the matches they played on are not touched.

const ZED: RosterMember = { tag: 'Zed#2100', display_name: 'Zed', note: 'main tank' }

let pinia: Pinia
const api = {
  SaveRosterMember: vi.fn(async () => undefined),
  DeleteRosterMember: vi.fn(async () => undefined),
  ListRoster: vi.fn(async () => [] as RosterMember[]),
}

function mount(members: RosterMember[]) {
  pinia = createPinia()
  setActivePinia(pinia)
  seedQuery(qk.roster, members)
  return render(SettingsRoster, { global: { plugins: [pinia] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  setApiBacking(api)
})

afterEach(async () => {
  await vi.dynamicImportSettled()
})

describe('SettingsRoster', () => {
  it('invites the first entry rather than showing an empty list', () => {
    mount([])
    expect(screen.getByText(/Nobody saved yet/)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows the name, the tag behind it, and the note', () => {
    mount([ZED])
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('Zed')).toBeInTheDocument()
    expect(within(row).getByText('Zed#2100')).toBeInTheDocument()
    expect(within(row).getByText('main tank')).toBeInTheDocument()
  })

  it('refuses to save until a tag is typed — the tag is the identity', async () => {
    mount([])
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await fireEvent.update(screen.getByLabelText('BattleTag'), 'Ari#1234')
    expect(save).toBeEnabled()
  })

  it('saves the tag, name and note, then clears the form', async () => {
    mount([])
    await fireEvent.update(screen.getByLabelText('BattleTag'), ' Ari#1234 ')
    await fireEvent.update(screen.getByLabelText('Name'), 'Ari')
    await fireEvent.update(screen.getByLabelText('Note'), 'flex support')
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await flushPromises()

    expect(api.SaveRosterMember).toHaveBeenCalledWith('Ari#1234', 'Ari', 'flex support')
    expect(screen.getByLabelText('BattleTag')).toHaveValue('')
  })

  it('says what removing does, in the words of what it actually does', () => {
    mount([ZED])
    // Not "delete": the roster is a lookup, and the matches Zed played on
    // keep the tag either way.
    expect(screen.getByText(/Removing somebody stops showing their name/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Zed from the roster' })).toBeInTheDocument()
  })

  it('surfaces a failed save instead of clearing the form over it', async () => {
    api.SaveRosterMember.mockRejectedValueOnce(new Error('roster: a teammate needs a tag'))
    mount([])
    await fireEvent.update(screen.getByLabelText('BattleTag'), 'Ari#1234')
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('a teammate needs a tag')
    expect(screen.getByLabelText('BattleTag')).toHaveValue('Ari#1234')
  })
})
