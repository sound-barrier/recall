import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import CoachCueStrip from '@/components/coach/notes/CoachCueStrip.vue'
import type { CoachMoment } from '@/match/coach/coach-moments'

const moment = (over: Partial<CoachMoment> = {}): CoachMoment => ({
  momentId: 'm-1', matchClock: '04:12', text: 'Walked in alone', focusTag: '', ...over,
})

function renderStrip(props: Record<string, unknown> = {}) {
  return render(CoachCueStrip, {
    props: { moments: [], gameLength: '09:30', replayCode: '', ...props },
  })
}

describe('CoachCueStrip', () => {
  // Restore here rather than at the end of the one test that stubs: a throw
  // before its mockRestore would leave crypto stubbed for the whole file.
  afterEach(() => { vi.restoreAllMocks() })

  it('invites a first moment instead of showing an empty axis', () => {
    renderStrip()
    expect(screen.getByText(/No moments yet/)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('orders moments by their clock, not by the order they were written', () => {
    renderStrip({
      moments: [
        moment({ momentId: 'b', matchClock: '07:00', text: 'late' }),
        moment({ momentId: 'a', matchClock: '02:00', text: 'early' }),
      ],
    })
    const groups = screen.getAllByRole('group', { name: /^Moment \d of 2, at/ })
    expect(groups[0]).toHaveAccessibleName('Moment 1 of 2, at 02:00')
    expect(groups[1]).toHaveAccessibleName('Moment 2 of 2, at 07:00')
  })

  it('names the match length while the rail is drawn to scale', () => {
    renderStrip({ moments: [moment()], gameLength: '09:30' })
    expect(screen.getByText('09:30 match')).toBeInTheDocument()
  })

  it('falls back to an even list when no capture reported a length', () => {
    // game_length is OCR-derived and absent on every manual match; scaling
    // against a number it does not have would be an invented axis.
    renderStrip({ moments: [moment()], gameLength: '' })
    expect(screen.queryByText(/match$/)).not.toBeInTheDocument()
  })

  it('mints an identity for a new moment so autosave can key on it', async () => {
    // The queue keys on the id from the first keystroke, so the row needs one
    // before anything has been saved.
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-3333-4444-555555555555')
    const { emitted } = renderStrip()
    await fireEvent.click(screen.getByRole('button', { name: '+ Mark a moment' }))
    expect(uuid).toHaveBeenCalled()
    expect((emitted('update') as CoachMoment[][])[0]![0]).toEqual(
      expect.objectContaining({ momentId: '11111111-2222-3333-4444-555555555555', text: '' }),
    )
  })

  it('relays a row removal with the id of the row that asked', async () => {
    const { emitted } = renderStrip({
      moments: [moment({ momentId: 'a', matchClock: '02:00' }), moment({ momentId: 'b', matchClock: '07:00' })],
    })
    await fireEvent.click(screen.getByRole('button', { name: /^Remove moment 2 of 2, at 07:00$/ }))
    expect((emitted('remove') as string[][])[0]![0]).toBe('b')
  })

  it('relays a replay-code copy', async () => {
    const { emitted } = renderStrip({ moments: [moment()], replayCode: 'AB12CD' })
    await fireEvent.click(screen.getByRole('button', { name: /^Copy replay code/ }))
    expect(emitted('copy-replay')).toHaveLength(1)
  })

  it('passes each row its own save state, not one shared by the strip', () => {
    renderStrip({
      moments: [moment({ momentId: 'a', matchClock: '02:00' }), moment({ momentId: 'b', matchClock: '07:00' })],
      saveStateFor: (id: string) => (id === 'b' ? 'error' : 'idle'),
    })
    const failures = screen.getAllByRole('status')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toHaveTextContent('Not saved — try again.')
  })

  it('refuses to add a moment while writes are blocked, and says why', () => {
    renderStrip({ blocked: true, blockedReason: 'A session is open' })
    const add = screen.getByRole('button', { name: '+ Mark a moment' })
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', 'A session is open')
  })
})
