import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@/test-utils'

import ManualMatchModal from '@/components/matches/manual/ManualMatchModal.vue'
import { ApiError, setApiBacking, type ManualMatchInput, type MatchRecord, type OWData } from '@/api-client'
import type { ManualMatchMode } from '@/composables/matches/manual/useManualMatchForm'
import { qk } from '@/queries/keys'
import { markdownField } from '@/test-utils'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The write gate reads the profiles query + the coaching-session store;
// these cases pin this component's own contract, so stub it open.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

// The form is inseparable from its shell: ManualMatchModal owns the single
// useManualMatchForm instance and provides it, and the submit path is the only
// place the assembled payload is observable. So these drive the real pair and
// assert through the accessible controls + the '@/api-client' seam.

// A miniature roster. The picker stores the NORMALIZED (lowercase) form, which
// is why every expectation below reads 'ilios' / 'ashe' rather than the display
// names. 'dps' is the roster's key for the role the UI chip calls "damage".
const ROSTER = {
  heroes_by_role: {
    tank: ['Reinhardt', 'D.Va'],
    dps: ['Genji', 'Ashe'],
    support: ['Lúcio', 'Ana'],
  },
  maps_by_game_mode: {
    control: ['Ilios', 'Busan'],
    escort: ['Dorado'],
  },
  screenshot_sources: [],
  seasons: [], patches: [],
} as unknown as OWData

const RECORD = { match_key: '2026-08-10T20-00', data: {} } as unknown as MatchRecord

// RFC3339 with a LOCAL offset — never a Z-suffixed UTC instant (that would
// shift the wall clock the Go side derives the match key from).
const LOCAL_RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/

type CreateManualMatchFn = (input: ManualMatchInput) => Promise<MatchRecord>
let createManualMatch: Mock<CreateManualMatchFn>

function renderModal(mode: ManualMatchMode = 'full') {
  // Seed BEFORE the first useOWData() call so its observer reads fresh data
  // and never fires the initial reference-data fetch.
  seedQuery(qk.system.referenceData, ROSTER)
  return render(ManualMatchModal, { props: { open: true, mode } })
}

const chip = (name: string) => screen.getByRole('button', { name })
const combo = (name: 'Map' | 'Heroes') => screen.getByRole('combobox', { name })
const submitBtn = () => screen.getByRole('button', { name: /Add match|Adding/ })
const status = () => screen.getByText(/Still needed:|Ready to add/)
const optionNames = () => screen.queryAllByRole('option').map((o) => o.textContent?.trim())
const sentPayload = () => createManualMatch.mock.calls[0]![0]

// Focus opens the dropdown; mousedown on an option selects it (the picker
// commits on mousedown so a blur can't beat the click).
async function pick(name: 'Map' | 'Heroes', option: string) {
  await fireEvent.focus(combo(name))
  await fireEvent.mouseDown(screen.getByRole('option', { name: option }))
}

// The shortest legal full-form entry: an open-queue quickplay win.
async function fillMinimalFullForm() {
  await pick('Map', 'ilios')
  await fireEvent.click(chip('Quick Play'))
  await fireEvent.click(chip('Open Queue'))
  await pick('Heroes', 'ana')
  await fireEvent.click(chip('victory'))
}

beforeEach(() => {

  setActivePinia(createPinia())
  createManualMatch = vi.fn<CreateManualMatchFn>(async () => RECORD)
  setApiBacking({ CreateManualMatch: createManualMatch })
})

describe('ManualMatchForm — required fields and payload', () => {
  it('names what is still missing, then POSTs the assembled payload once complete', async () => {
    renderModal()
    expect(status()).toHaveTextContent('Still needed: map, mode, queue, result, a hero')
    expect(submitBtn()).toBeDisabled()

    await pick('Map', 'ilios')
    await fireEvent.click(chip('Competitive'))
    await fireEvent.click(chip('Role Queue'))
    // Role queue adds a requirement the other queue doesn't have.
    expect(status()).toHaveTextContent('Still needed: role, result, a hero')

    await fireEvent.click(chip('damage'))
    await pick('Heroes', 'ashe')
    await fireEvent.click(chip('victory'))
    expect(status()).toHaveTextContent('Ready to add')
    expect(submitBtn()).toBeEnabled()

    await fireEvent.click(submitBtn())
    expect(createManualMatch).toHaveBeenCalledTimes(1)
    expect(sentPayload()).toEqual({
      map: 'ilios',
      play_mode: 'competitive',
      queue_type: 'role',
      heroes: ['ashe'],
      result: 'victory',
      played_at: expect.stringMatching(LOCAL_RFC3339),
    })
  })

  it('marks the picked mode / queue / result chips pressed and lets a later pick replace them', async () => {
    renderModal()
    await fireEvent.click(chip('Competitive'))
    expect(chip('Competitive')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Quick Play')).toHaveAttribute('aria-pressed', 'false')

    await fireEvent.click(chip('Quick Play'))
    expect(chip('Competitive')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('Quick Play')).toHaveAttribute('aria-pressed', 'true')

    await fireEvent.click(chip('defeat'))
    await fireEvent.click(chip('draw'))
    expect(chip('defeat')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('draw')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ManualMatchForm — hero legality follows the queue', () => {
  it('offers only the picked role on role queue, mapping the Damage chip to the dps roster', async () => {
    renderModal()
    await fireEvent.click(chip('Role Queue'))

    // No role yet: the picker says so instead of listing every hero.
    expect(combo('Heroes')).toHaveAttribute('placeholder', 'pick a role first')
    await fireEvent.focus(combo('Heroes'))
    expect(optionNames()).toEqual([])
    expect(screen.getByText('pick a role above first')).toBeInTheDocument()

    // The chip reads "damage"; the roster files group those heroes under
    // 'dps'. Without the translation this list came back empty and a
    // role-queue damage match could never be entered.
    await fireEvent.click(chip('damage'))
    expect(optionNames()).toEqual(['ashe', 'genji'])

    await fireEvent.click(chip('support'))
    expect(optionNames()).toEqual(['ana', 'lucio'])

    // Clicking the picked role again un-picks it, which puts the hero list
    // back to "choose a role first" rather than silently offering everyone.
    await fireEvent.click(chip('support'))
    expect(chip('support')).toHaveAttribute('aria-pressed', 'false')
    expect(optionNames()).toEqual([])
    expect(status()).toHaveTextContent('role')
  })

  it('offers every hero on open queue and asks for no role there', async () => {
    renderModal()
    await fireEvent.click(chip('Open Queue'))
    expect(screen.queryByRole('button', { name: 'damage' })).not.toBeInTheDocument()

    await fireEvent.focus(combo('Heroes'))
    expect(optionNames()).toEqual(['ana', 'ashe', 'd.va', 'genji', 'lucio', 'reinhardt'])
  })

  it('drops a hero that the new role makes illegal', async () => {
    renderModal()
    await fireEvent.click(chip('Role Queue'))
    await fireEvent.click(chip('support'))
    await pick('Heroes', 'ana')
    expect(screen.getByRole('button', { name: 'Drop ana' })).toBeInTheDocument()

    // Switching to tank: ana is no longer playable, so the pick goes with it
    // rather than riding along into the payload.
    await fireEvent.click(chip('tank'))
    expect(screen.queryByRole('button', { name: 'Drop ana' })).not.toBeInTheDocument()
    expect(status()).toHaveTextContent('a hero')
  })
})

describe('ManualMatchForm — the two pickers', () => {
  it('keeps Map single-select: a pick replaces, re-picking clears, and the list closes', async () => {
    renderModal()
    await fireEvent.focus(combo('Map'))
    expect(combo('Map')).toHaveAttribute('aria-expanded', 'true')

    await fireEvent.mouseDown(screen.getByRole('option', { name: 'ilios' }))
    expect(combo('Map')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Drop ilios' })).toBeInTheDocument()

    await pick('Map', 'busan')
    expect(screen.queryByRole('button', { name: 'Drop ilios' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop busan' })).toBeInTheDocument()

    await pick('Map', 'busan')
    expect(screen.queryByRole('button', { name: 'Drop busan' })).not.toBeInTheDocument()
    expect(status()).toHaveTextContent('map')
  })

  it('keeps Heroes multi-select and open, badging the first pick primary', async () => {
    renderModal()
    await fireEvent.click(chip('Open Queue'))
    await pick('Heroes', 'ana')
    // Still open — a multi-select picker does not close between picks.
    expect(combo('Heroes')).toHaveAttribute('aria-expanded', 'true')
    await fireEvent.mouseDown(screen.getByRole('option', { name: 'genji' }))

    expect(screen.getAllByText('primary')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Drop ana' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop genji' })).toBeInTheDocument()

    // Dropping the primary promotes the survivor rather than leaving a hole.
    await fireEvent.click(screen.getByRole('button', { name: 'Drop ana' }))
    await fireEvent.click(chip('victory'))
    await pick('Map', 'ilios')
    await fireEvent.click(chip('Quick Play'))
    await fireEvent.click(submitBtn())
    expect(sentPayload().heroes).toEqual(['genji'])
  })

  it('closes the open dropdown on a click outside, but not on one inside it', async () => {
    renderModal()
    await fireEvent.focus(combo('Map'))
    // A mousedown inside the combo's own subtree (the listbox chrome, not an
    // option) must not be mistaken for an outside click.
    await fireEvent.mouseDown(screen.getByRole('listbox', { name: 'Map' }))
    expect(combo('Map')).toHaveAttribute('aria-expanded', 'true')

    await fireEvent.mouseDown(document.body)
    expect(combo('Map')).toHaveAttribute('aria-expanded', 'false')
  })

  it('lets Escape in a picker close the list without tearing down the modal', async () => {
    renderModal()
    await fireEvent.focus(combo('Map'))
    await fireEvent.keyDown(combo('Map'), { key: 'Escape' })
    expect(combo('Map')).toHaveAttribute('aria-expanded', 'false')
    // A mid-entry Escape must not throw the half-filled form away.
    expect(screen.getByRole('dialog', { name: 'Hand-enter a match' })).toBeInTheDocument()
  })

  it('toggles a picker open and shut from its caret button', async () => {
    renderModal()
    await fireEvent.click(chip('Open Queue'))
    await fireEvent.click(screen.getByRole('button', { name: 'Open Heroes list' }))
    expect(combo('Heroes')).toHaveAttribute('aria-expanded', 'true')
    await fireEvent.click(screen.getByRole('button', { name: 'Close Heroes list' }))
    expect(combo('Heroes')).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('ManualMatchForm — the leaver-exit quick-add', () => {
  it('asks for map and result only, and posts the pre-tagged leaver pair', async () => {
    renderModal('leaver-exit')
    expect(screen.getByText(/Overwatch drops matches you leave early/)).toBeInTheDocument()
    // Everything the user cannot know about a match they walked out of is gone.
    expect(screen.queryByRole('button', { name: 'Competitive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Queue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Heroes' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Notes/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Add a tag')).not.toBeInTheDocument()
    expect(status()).toHaveTextContent('Still needed: map, result')

    await pick('Map', 'dorado')
    await fireEvent.click(chip('defeat'))
    await fireEvent.click(submitBtn())

    expect(sentPayload()).toEqual({
      map: 'dorado',
      result: 'defeat',
      // "A teammate left, which is what let me leave, and then I did."
      leavers: ['team', 'self'],
      played_at: expect.stringMatching(LOCAL_RFC3339),
    })
  })
})

describe('ManualMatchForm — rank', () => {
  it('shows the rank block for competitive only', async () => {
    renderModal()
    await fireEvent.click(chip('Quick Play'))
    expect(screen.queryByLabelText('Tier')).not.toBeInTheDocument()

    await fireEvent.click(chip('Competitive'))
    expect(screen.getByLabelText('Tier')).toBeInTheDocument()
  })

  it('blocks submit with an alert while progress or RR change is out of bounds', async () => {
    renderModal()
    await fillMinimalFullForm()
    await fireEvent.click(chip('Competitive'))
    // No tier picked: rank is inert, so the out-of-range number is ignored.
    await fireEvent.update(screen.getByLabelText('Progress %'), '150')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(submitBtn()).toBeEnabled()

    await fireEvent.update(screen.getByLabelText('Tier'), 'gold')
    expect(screen.getByRole('alert')).toHaveTextContent('Progress must be between 0 and 100.')
    expect(submitBtn()).toBeDisabled()

    await fireEvent.update(screen.getByLabelText('Progress %'), '40')
    await fireEvent.update(screen.getByLabelText('RR change %'), '2000000')
    expect(screen.getByRole('alert')).toHaveTextContent('RR change must be within ±1,000,000.')
    expect(submitBtn()).toBeDisabled()
  })

  it('sends the rank block only when a tier is picked', async () => {
    renderModal()
    await fillMinimalFullForm()
    await fireEvent.click(chip('Competitive'))
    // The option VALUE is the lowercase form every other layer stores; the
    // label is title-cased for display only. This test used to drive it with
    // 'Diamond' and assert 'Diamond' came back — pinning the bug where a
    // manual match stored a tier no chart could resolve.
    await fireEvent.update(screen.getByLabelText('Tier'), 'diamond')
    await fireEvent.update(screen.getByLabelText('Division'), '3')
    await fireEvent.update(screen.getByLabelText('Progress %'), '65')
    await fireEvent.update(screen.getByLabelText('RR change %'), '-12')
    await fireEvent.click(screen.getByLabelText('Demotion protection'))

    await fireEvent.click(submitBtn())
    expect(sentPayload().rank).toEqual({
      tier: 'diamond',
      division: 3,
      progress: 65,
      change_percent: -12,
      demotion_protection: true,
    })
  })
})

describe('ManualMatchForm — annotations', () => {
  it('adds tags on Enter, lowercases and dedupes them, and removes one on click', async () => {
    renderModal()
    const tagInput = screen.getByLabelText('Add a tag')
    await fireEvent.update(tagInput, 'Tilt')
    await fireEvent.keyDown(tagInput, { key: 'Enter' })
    await fireEvent.update(tagInput, 'tilt')
    await fireEvent.keyDown(tagInput, { key: 'Enter' })
    await fireEvent.update(tagInput, 'smurf')
    await fireEvent.keyDown(tagInput, { key: 'Enter' })

    expect(screen.getByRole('button', { name: 'Remove tag tilt' })).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Remove tag smurf' }))
    expect(screen.queryByRole('button', { name: 'Remove tag smurf' })).not.toBeInTheDocument()
  })

  it('adds teammates on Enter, keeping their case, and removes one on click', async () => {
    renderModal()
    const memberInput = screen.getByLabelText('Add a teammate')
    await fireEvent.update(memberInput, 'Apollo#11234')
    await fireEvent.keyDown(memberInput, { key: 'Enter' })
    await fireEvent.update(memberInput, 'apollo#11234')
    await fireEvent.keyDown(memberInput, { key: 'Enter' })
    // Case-distinct BattleTags are two different people, not a duplicate.
    expect(screen.getByRole('button', { name: 'Remove teammate Apollo#11234' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove teammate apollo#11234' })).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Remove teammate Apollo#11234' }))
    expect(screen.queryByRole('button', { name: 'Remove teammate Apollo#11234' })).not.toBeInTheDocument()
  })

  it('commits a typed-but-not-Entered tag and teammate on submit', async () => {
    renderModal()
    await fillMinimalFullForm()
    // Typed into the box and then straight to Add — the draft must not be lost.
    await fireEvent.update(screen.getByLabelText('Add a tag'), 'Throwing')
    await fireEvent.update(screen.getByLabelText('Add a teammate'), 'Apollo#11234')

    await fireEvent.click(submitBtn())
    expect(sentPayload().tags).toEqual(['throwing'])
    // Members keep their case — Apollo#11234 and apollo#11234 are distinct.
    expect(sentPayload().members).toEqual(['Apollo#11234'])
  })

  it('carries the optional replay code, note, leavers and throwers when filled', async () => {
    renderModal()
    await fillMinimalFullForm()
    await fireEvent.update(screen.getByLabelText(/^Replay code/), 'A1B2C3')
    // Markdown mode: this is about what the FORM sends, and the raw field
    // answers fireEvent.update where a document editor does not.
    await fireEvent.update(await markdownField('Notes'), '  fed early  ')
    await fireEvent.click(chip('Ally left'))
    await fireEvent.click(chip('Enemy threw'))
    expect(chip('Ally left')).toHaveAttribute('aria-pressed', 'true')

    await fireEvent.click(submitBtn())
    expect(sentPayload()).toMatchObject({
      replay_code: 'A1B2C3',
      note: 'fed early',
      leavers: ['team'],
      throwers: ['enemy'],
    })
  })

  it('sends an edited When as local-offset RFC3339, never a UTC instant', async () => {
    renderModal()
    await fillMinimalFullForm()
    await fireEvent.update(screen.getByLabelText(/^When/), '2026-03-14T21:45')

    await fireEvent.click(submitBtn())
    // The wall clock the user typed has to survive: the Go side derives the
    // match key and date from it, so a toISOString() conversion would move
    // the match to a different minute (and sometimes a different day).
    expect(sentPayload().played_at).toMatch(/^2026-03-14T21:45:00[+-]\d{2}:\d{2}$/)
  })

  it('omits every optional field the user left alone', async () => {
    renderModal()
    await fillMinimalFullForm()
    await fireEvent.click(submitBtn())
    const sent = sentPayload()
    expect(sent.leavers).toBeUndefined()
    expect(sent.throwers).toBeUndefined()
    expect(sent.replay_code).toBeUndefined()
    expect(sent.note).toBeUndefined()
    expect(sent.tags).toBeUndefined()
    expect(sent.members).toBeUndefined()
    expect(sent.rank).toBeUndefined()
  })
})

describe('ManualMatchForm — dismissal', () => {
  it('closes from Cancel and from the × without posting anything', async () => {
    const view = renderModal()
    await fillMinimalFullForm()
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Close (Esc)' }))
    expect(view.emitted('close')).toHaveLength(2)
    expect(createManualMatch).not.toHaveBeenCalled()
  })
})

describe('ManualMatchForm — submit failures', () => {
  it('shows the server message inline and keeps the form open for a retry', async () => {
    createManualMatch.mockRejectedValueOnce(
      new ApiError(409, 'A match already exists at that time; pick a different minute.'),
    )
    renderModal()
    await fillMinimalFullForm()
    await fireEvent.click(submitBtn())
    await flushPromises()

    expect(screen.getByRole('alert')).toHaveTextContent('A match already exists at that time')
    // Still open, still armed — the entry is not thrown away.
    expect(screen.getByRole('dialog', { name: 'Hand-enter a match' })).toBeInTheDocument()
    expect(submitBtn()).toBeEnabled()

    await fireEvent.click(submitBtn())
    expect(createManualMatch).toHaveBeenCalledTimes(2)
  })

  it('renders a non-ApiError failure rather than swallowing it', async () => {
    createManualMatch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderModal()
    await fillMinimalFullForm()
    await fireEvent.click(submitBtn())
    await flushPromises()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')
  })

  it('blocks a second submit while the first is in flight', async () => {
    let release!: (r: MatchRecord) => void
    createManualMatch.mockImplementationOnce(() => new Promise<MatchRecord>((res) => { release = res }))
    renderModal()
    await fillMinimalFullForm()
    await fireEvent.click(submitBtn())

    expect(submitBtn()).toHaveTextContent('Adding…')
    expect(submitBtn()).toBeDisabled()
    await fireEvent.click(submitBtn())
    expect(createManualMatch).toHaveBeenCalledTimes(1)

    release(RECORD)
    await new Promise((r) => setTimeout(r, 0))
    expect(submitBtn()).toHaveTextContent('Add match')
  })
})
