import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import type { FieldFlag, MatchRecord } from '@/api'
import { ApiError, setApiBacking } from '@/api-client'
import UnknownFieldFlagSection from '@/components/unknown/UnknownFieldFlagSection.vue'
import { FIELD_FLAG_SECTION } from '@/match/quality/field-flags'
import { qk } from '@/queries/keys'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { seedQuery } from '@/test-utils/queryTestUtils'

vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

// The section lists one card per flag — open ones first, settled ones behind
// "N reviewed" — and does the writing the cards ask for. Every write here
// goes through useMatchActions, so these pin what reaches the api and what the
// player is told when the reading moved under them.

const KEY = 'match-2026-06-07T23-00-04'

const flag = (field: string, state: FieldFlag['state'] = 'open', value = '74'): FieldFlag => ({
  field, value, checks: ['perf_total_vs_rate'], state,
  readings: [
    { source_file: 'summary.jpg', origin: 'ocr', value },
    { source_file: 'summary.jpg', origin: 'derived', value: '9' },
  ],
})

const record = (flags: FieldFlag[]): MatchRecord => ({
  match_key: KEY, source_files: ['summary.jpg'],
  data: { map: 'rialto', date: '2026-06-07', eliminations: 74, assists: 9, deaths: 6, damage: 7200 },
  field_flags: flags,
})

const api = {
  GetMatchResults: vi.fn(async () => [] as MatchRecord[]),
  GetFailedFiles: vi.fn(async () => []),
  GetNewScreenshotCount: vi.fn(async () => ({ count: 0, parked: 0 })),
  GetMatchFieldRegions: vi.fn(async () => []),
  ConfirmFieldReading: vi.fn(async () => undefined),
  UnconfirmFieldReading: vi.fn(async () => undefined),
  UpdateMatchData: vi.fn(async () => undefined),
}

function mount(records: MatchRecord[], reveal = false) {
  setActivePinia(createPinia())
  api.GetMatchResults.mockResolvedValue(records)
  seedQuery(qk.matches, records)
  useMatchesStore()
  if (reveal) useUiStore().revealSection(FIELD_FLAG_SECTION)
  return render(UnknownFieldFlagSection)
}

const openCard = () => screen.getByRole('article', { name: /^Flagged reading: Eliminations/ })

beforeEach(() => { setApiBacking(api) })
afterEach(() => { vi.clearAllMocks() })

describe('UnknownFieldFlagSection', () => {
  it('renders nothing while no reading is flagged', () => {
    mount([{ ...record([]), field_flags: undefined }])
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('counts the open flags and keeps the settled ones behind the disclosure', async () => {
    mount([record([flag('data.eliminations'), flag('data.damage', 'confirmed', '7200')])])

    expect(screen.getByRole('heading', { name: 'Flagged readings — 1' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: /^Flagged reading: Damage/ })).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: '1 reviewed — show' }))
    expect(screen.getByRole('article', { name: /^Flagged reading: Damage/ })).toHaveTextContent('Confirmed')
  })

  it('says all are reviewed when nothing is open', () => {
    mount([record([flag('data.eliminations', 'confirmed')])])
    expect(screen.getByRole('heading', { name: 'Flagged readings — all reviewed' })).toBeInTheDocument()
  })

  it('confirms the value the card showed', async () => {
    mount([record([flag('data.eliminations')])])

    await fireEvent.click(within(openCard()).getByRole('button', { name: /^Confirm as read/ }))
    expect(api.ConfirmFieldReading).toHaveBeenCalledWith(KEY, 'data.eliminations', '74')
  })

  it('tells the player when the reading changed under them', async () => {
    mount([record([flag('data.eliminations')])])
    api.ConfirmFieldReading.mockRejectedValueOnce(new ApiError(409, 'the flagged reading changed since it was shown'))
    api.GetMatchResults.mockResolvedValue([record([flag('data.eliminations', 'open', '75')])])

    await fireEvent.click(within(openCard()).getByRole('button', { name: /^Confirm as read/ }))

    await waitFor(() => expect(within(openCard()).getByRole('status')).toHaveTextContent(
      'This reading changed since you looked — Recall refreshed it. Check the new value before you confirm.',
    ))
    await waitFor(() => expect(openCard()).toHaveTextContent('Reads 75'))
  })

  it('writes the other reading through the override set', async () => {
    mount([record([flag('data.eliminations')])])

    await fireEvent.click(within(openCard()).getByRole('button', { name: /^Use 9/ }))
    expect(api.UpdateMatchData).toHaveBeenCalledWith(KEY, { eliminations: 9 })
  })

  it('re-opens a confirmation', async () => {
    mount([record([flag('data.eliminations', 'confirmed')])])

    await fireEvent.click(screen.getByRole('button', { name: '1 reviewed — show' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Re-open Eliminations' }))
    expect(api.UnconfirmFieldReading).toHaveBeenCalledWith(KEY, 'data.eliminations')
  })

  // A settled card leaves the list it was in, taking the button that held
  // focus with it. Focus moves on to the work that is left, and one
  // section-level status line says where the card went — the card's own
  // status line unmounts with it.
  describe('after a settle', () => {
    const statuses = () => screen.getAllByRole('status').map((s) => s.textContent?.trim())
    const damageCard = () => screen.getByRole('article', { name: /^Flagged reading: Damage/ })

    it('moves focus to the next open card and says the settled one moved', async () => {
      mount([record([flag('data.eliminations'), flag('data.damage', 'open', '7200')])])
      api.GetMatchResults.mockResolvedValue([record([flag('data.eliminations', 'confirmed'), flag('data.damage', 'open', '7200')])])

      await fireEvent.click(within(openCard()).getByRole('button', { name: /^Confirm as read/ }))

      await waitFor(() => expect(damageCard()).toHaveFocus())
      expect(statuses()).toContain('Eliminations confirmed — moved to 1 reviewed.')
    })

    it('moves focus to the heading when nothing is left open', async () => {
      mount([record([flag('data.eliminations')])])
      api.GetMatchResults.mockResolvedValue([{ ...record([flag('data.eliminations', 'edited')]), edited_fields: ['data.eliminations'] }])

      await fireEvent.click(within(openCard()).getByRole('button', { name: /^Use 9/ }))

      await waitFor(() => expect(screen.getByRole('heading', { name: 'Flagged readings — all reviewed' })).toHaveFocus())
      expect(statuses()).toContain('Eliminations corrected — moved to 1 reviewed.')
    })

    it('moves focus to a re-opened card in the open list', async () => {
      mount([record([flag('data.eliminations', 'confirmed')])])
      api.GetMatchResults.mockResolvedValue([record([flag('data.eliminations')])])

      await fireEvent.click(screen.getByRole('button', { name: '1 reviewed — show' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Re-open Eliminations' }))

      await waitFor(() => expect(openCard()).toHaveFocus())
      expect(within(openCard()).getByRole('button', { name: /^Confirm as read/ })).toBeInTheDocument()
      expect(statuses()).toContain('Eliminations re-opened — 1 open.')
    })
  })

  it('takes focus when another surface sent the player here', async () => {
    mount([record([flag('data.eliminations')])], true)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Flagged readings — 1' })).toHaveFocus())
  })
})
