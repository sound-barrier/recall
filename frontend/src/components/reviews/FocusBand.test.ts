import { render, screen, fireEvent, within } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FocusEntry } from '@/api'
import { setApiBacking } from '@/api-client'
import FocusBand from '@/components/reviews/FocusBand.vue'

function entry(over: Partial<FocusEntry> = {}): FocusEntry {
  return {
    item_id: 'i-1', text: 'hold the angle', status: 'working',
    source: 'self', from: '2026-08-18', ...over,
  }
}

let setStatus = vi.fn(async () => undefined)

function renderBand(entries: FocusEntry[], blockedReason = '') {
  setActivePinia(createPinia())
  setStatus = vi.fn(async () => undefined)
  setApiBacking({ SetFocusItemStatus: setStatus })
  return render(FocusBand, { props: { entries, blockedReason } })
}

describe('FocusBand', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('invites you to start when there is nothing yet', () => {
    renderBand([])
    expect(screen.getByText(/Finish a review, or open a coach's notes/)).toBeInTheDocument()
  })

  it('says where each item came from and when', () => {
    renderBand([
      entry({ item_id: 'c', source: 'coach', coach_name: 'Ordo', status: 'new', from: '2026-08-14' }),
      entry({ item_id: 's', text: 'ult economy' }),
    ])
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent(/Ordo/)
    expect(rows[0]).toHaveTextContent(/new/)
    expect(rows[1]).toHaveTextContent(/you/)
  })

  // "A player can disagree with their coach, but they need to listen to
  // them." An item that arrived is already live; the only choices are
  // acknowledging it and retiring it.
  it('offers Accept and Got this — and never a way to refuse', () => {
    renderBand([entry({ source: 'coach', coach_name: 'Ordo', status: 'new' })])
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got this' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /deny|reject|skip|dismiss|delete/i })).not.toBeInTheDocument()
  })

  it('offers no Accept on an item you wrote yourself', () => {
    renderBand([entry()])
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got this' })).toBeInTheDocument()
  })

  it('accepts a coach item into working', async () => {
    renderBand([entry({ item_id: 'c-1', source: 'coach', status: 'new' })])
    await fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(setStatus).toHaveBeenCalledWith('c-1', 'working')
  })

  it('retires an item without deleting it', async () => {
    renderBand([entry({ item_id: 's-1' })])
    await fireEvent.click(screen.getByRole('button', { name: 'Got this' }))
    expect(setStatus).toHaveBeenCalledWith('s-1', 'done')
  })

  it('folds what you have got behind a count, and opens it', async () => {
    renderBand([entry({ item_id: 'a' }), entry({ item_id: 'b', text: 'ult economy', status: 'done' })])
    expect(screen.queryByText('ult economy')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: "Show 1 you've got" })
    await fireEvent.click(toggle)
    expect(screen.getByText('ult economy')).toBeInTheDocument()
  })

  it('refuses both moves while writes are locked, and says why', () => {
    renderBand([entry({ source: 'coach', status: 'new' })], 'A coaching session is open.')
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Got this' })).toBeDisabled()
  })

  it('keeps the live list in the order it was handed', () => {
    renderBand([
      entry({ item_id: '1', text: 'first', source: 'coach', status: 'new' }),
      entry({ item_id: '2', text: 'second' }),
    ])
    const list = screen.getAllByRole('list')[0]!
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('first')
    expect(rows[1]).toHaveTextContent('second')
  })
})
