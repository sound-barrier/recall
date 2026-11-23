import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import type { FieldFlag, FieldRegion, MatchRecord } from '@/api'
import { setApiBacking } from '@/api-client'
import UnknownFieldFlagCard from '@/components/unknown/UnknownFieldFlagCard.vue'
import { resetWriteGate, setWritesLocked, STUB_LOCK_REASON } from '@/test-utils/writeGateStub'

vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

// One flagged reading: what the match reads, why the check doubted it, every
// reading it compared, and the pixels each was read from — with the ways to
// settle it that fit the field. The card asks; the section writes.

const KEY = 'match-2026-06-07T23-00-04'

const flag = (over: Partial<FieldFlag> = {}): FieldFlag => ({
  field: 'data.eliminations', value: '74', checks: ['perf_total_vs_rate'], state: 'open',
  readings: [
    { source_file: 'summary.jpg', origin: 'ocr', value: '74' },
    { source_file: 'summary.jpg', origin: 'derived', value: '9' },
  ],
  ...over,
})

const record = (): MatchRecord => ({
  match_key: KEY, source_files: ['summary.jpg'],
  data: { map: 'rialto', date: '2026-06-07', eliminations: 74, heroes_played: [{ hero: 'lucio' }] },
})

const region = (field = 'data.eliminations'): FieldRegion => ({
  source_file: 'summary.jpg', dir_id: 0, field,
  x: 400, y: 300, width: 80, height: 40, image_width: 1920, image_height: 1080,
})

const GetMatchFieldRegions = vi.fn(async (_key: string) => [region(), region('data.damage')])

async function mount(f: FieldFlag = flag(), notice = '') {
  setActivePinia(createPinia())
  const view = render(UnknownFieldFlagCard, { props: { rec: record(), flag: f, notice, busy: false } })
  await new Promise((r) => setTimeout(r, 0))
  return view
}

const card = () => screen.getByRole('article', { name: /^Flagged reading: Eliminations/ })

beforeEach(() => {
  resetWriteGate()
  // The crop warms the ui store's preload registry; the store graph it
  // pulls in reads the match cluster on first use.
  setApiBacking({
    GetMatchFieldRegions,
    GetMatchResults: vi.fn(async () => []),
    GetFailedFiles: vi.fn(async () => []),
    GetNewScreenshotCount: vi.fn(async () => ({ count: 0, parked: 0 })),
  })
})
afterEach(() => { vi.clearAllMocks() })

describe('UnknownFieldFlagCard — an open flag', () => {
  it('shows the value, why it was doubted, each reading, and the crop it was read from', async () => {
    await mount()

    expect(card()).toHaveTextContent('Reads 74')
    expect(card()).toHaveTextContent('The total disagrees with its own per-10-minute rate over the time played.')
    const readings = within(screen.getByRole('list', { name: 'Readings compared' })).getAllByRole('listitem')
    expect(readings.map((li) => li.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '74 — read by OCR from summary.jpg',
      '9 — worked out from summary.jpg',
    ])
    expect(GetMatchFieldRegions).toHaveBeenCalledWith(KEY)
    // Only the flagged field's region is drawn, not every region of the match.
    expect(screen.getAllByRole('img', { name: /^Source crop of/ })).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Source crop of Eliminations from summary.jpg' })).toBeInTheDocument()
  })

  it('says so when no region was recorded for the field', async () => {
    GetMatchFieldRegions.mockResolvedValueOnce([])
    await mount()

    expect(card()).toHaveTextContent('No crop recorded')
  })

  it('confirms the value it shows', async () => {
    const { emitted } = await mount()

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm as read: Eliminations 74' }))
    expect(emitted('confirm')).toHaveLength(1)
  })

  it('offers the other reading as a one-click write', async () => {
    const { emitted } = await mount()

    await fireEvent.click(screen.getByRole('button', { name: 'Use 9 (worked out from summary.jpg)' }))
    expect(emitted('write')).toEqual([['9']])
  })

  it('edits through a labeled field and will not save a value the field cannot hold', async () => {
    const { emitted } = await mount()

    await fireEvent.click(screen.getByRole('button', { name: 'Edit Eliminations' }))
    const input = screen.getByLabelText('Corrected Eliminations')
    expect(input).toHaveValue('74')

    await fireEvent.update(input, '9.5')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(input).toHaveAccessibleDescription('Enter a whole number.')

    await fireEvent.update(input, '12')
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(emitted('write')).toEqual([['12']])
  })

  // Edit and Cancel each unmount the control holding focus; focus goes where
  // the player's next keystroke belongs, never to <body>.
  it('puts focus in the field when Edit opens it, and back on Edit when Cancel closes it', async () => {
    await mount()

    await fireEvent.click(screen.getByRole('button', { name: 'Edit Eliminations' }))
    await waitFor(() => expect(screen.getByLabelText('Corrected Eliminations')).toHaveFocus())

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Eliminations' })).toHaveFocus())
  })

  it('edits a result by choosing one of the three', async () => {
    const { emitted } = await mount(flag({ field: 'data.result', value: 'victory', checks: ['result_vs_rank_movement'], readings: [
      { source_file: 'summary.jpg', origin: 'ocr', value: 'victory' },
      { source_file: 'rank.png', origin: 'derived', value: 'defeat' },
    ] }))

    await fireEvent.click(screen.getByRole('button', { name: 'Edit Result' }))
    await fireEvent.update(screen.getByRole('combobox', { name: 'Corrected Result' }), 'draw')
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(emitted('write')).toEqual([['draw']])
  })

  it('offers Confirm alone for who was played, and says where to change it', async () => {
    await mount(flag({ field: 'data.heroes_played', value: 'lucio', checks: ['source_disagreement'], readings: [
      { source_file: 'summary.jpg', origin: 'ocr', value: 'lucio' },
      { source_file: 'teams.png', origin: 'ocr', value: 'lucio, juno' },
    ] }))

    const flagged = screen.getByRole('article', { name: /^Flagged reading: Heroes played/ })
    expect(within(flagged).getByRole('button', { name: /^Confirm as read/ })).toBeInTheDocument()
    expect(within(flagged).queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(within(flagged).queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
    expect(flagged).toHaveTextContent("Change it in the match's own detail if it's wrong.")
  })

  it('carries the section\'s news in its status line', async () => {
    await mount(flag(), 'This reading changed since you looked.')

    expect(within(card()).getByRole('status')).toHaveTextContent('This reading changed since you looked.')
  })

  it('disables every write while writes are locked, saying why', async () => {
    setWritesLocked(true)
    await mount()

    for (const name of [/^Confirm as read/, /^Use 9/, /^Edit/]) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', STUB_LOCK_REASON)
    }
  })

  it('reads no regions and loads no screenshot in a coaching session', async () => {
    setWritesLocked(true, { session: true })
    await mount()

    expect(GetMatchFieldRegions).not.toHaveBeenCalled()
    expect(screen.queryByRole('img', { name: /^Source crop of/ })).not.toBeInTheDocument()
    expect(card()).toHaveTextContent("Screenshots aren't included in a coaching session.")
  })
})

describe('UnknownFieldFlagCard — a settled flag', () => {
  it('a confirmed reading says so and can be re-opened', async () => {
    const { emitted } = await mount(flag({ state: 'confirmed' }))

    expect(card()).toHaveTextContent('Confirmed')
    expect(screen.queryByRole('button', { name: /^Confirm as read/ })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Re-open Eliminations' }))
    expect(emitted('unconfirm')).toHaveLength(1)
  })

  it('an edited reading points at the edit, which is what undoes it', async () => {
    await mount(flag({ state: 'edited' }))

    expect(card()).toHaveTextContent('Edited')
    expect(card()).toHaveTextContent('Settled by your edit')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
