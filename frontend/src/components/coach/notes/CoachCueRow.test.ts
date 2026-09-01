import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import CoachCueRow from '@/components/coach/notes/CoachCueRow.vue'
import type { CoachMoment } from '@/match/coach/coach-moments'

const moment = (over: Partial<CoachMoment> = {}): CoachMoment => ({
  momentId: 'm-1', matchClock: '04:12', text: 'Walked in alone', focusTag: '', imageSHA256: '', ...over,
})

function renderRow(props: Record<string, unknown> = {}) {
  return render(CoachCueRow, {
    props: { moment: moment(), gameLength: '09:30', replayCode: '', index: 0, total: 3, ...props },
  })
}

describe('CoachCueRow', () => {
  it('names the row by its time once the moment is real', () => {
    renderRow()
    expect(screen.getByRole('group', { name: /^Moment 1 of 3, at 04:12$/ })).toBeInTheDocument()
  })

  it('keeps calling it a new moment while it is still being written', () => {
    // Renaming the group the instant a clock is typed would move the landmark
    // under a screen-reader user who is mid-sentence.
    renderRow({ moment: moment({ text: '' }) })
    expect(screen.getByRole('group', { name: /^New moment 1 of 3$/ })).toBeInTheDocument()
  })

  it('distinguishes two unfinished rows by position', () => {
    renderRow({ moment: moment({ text: '' }), index: 1, total: 3 })
    expect(screen.getByRole('group', { name: /^New moment 2 of 3$/ })).toBeInTheDocument()
  })

  it('emits the edited text without touching the rest of the moment', async () => {
    const { emitted } = renderRow()
    await fireEvent.update(screen.getByLabelText('What happened'), 'Used ult on a full team')
    const updates = emitted('update') as CoachMoment[][]
    expect(updates[0]![0]).toEqual(
      expect.objectContaining({ momentId: 'm-1', matchClock: '04:12', text: 'Used ult on a full team' }),
    )
  })

  it('sets a focus tag, and clears it when the same chip is pressed again', async () => {
    const { emitted } = renderRow({ moment: moment({ focusTag: 'positioning' }) })
    const chip = screen.getByRole('button', { name: 'positioning' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await fireEvent.click(chip)
    expect((emitted('update') as CoachMoment[][])[0]![0]!.focusTag).toBe('')
  })

  it('sets a different tag by replacing the current one', async () => {
    const { emitted } = renderRow({ moment: moment({ focusTag: 'positioning' }) })
    await fireEvent.click(screen.getByRole('button', { name: 'comms' }))
    expect((emitted('update') as CoachMoment[][])[0]![0]!.focusTag).toBe('comms')
  })

  it('offers no replay affordance when the player never entered a code', () => {
    // An empty copy button would be a promise the data cannot keep.
    renderRow({ replayCode: '' })
    expect(screen.queryByRole('button', { name: /Copy replay code/ })).not.toBeInTheDocument()
  })

  it('hands over the replay code when there is one', async () => {
    const { emitted } = renderRow({ replayCode: 'AB12CD' })
    expect(screen.getByText('replay AB12CD')).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: /^Copy replay code for moment 1 of 3, at 04:12$/ }))
    expect(emitted('copy-replay')).toHaveLength(1)
  })

  it('shows a refused save on the row itself', () => {
    // The desk indicator is keyed on the match; a moment the server refused
    // otherwise looked exactly like a saved one.
    renderRow({ saveState: 'error' })
    expect(screen.getByRole('status')).toHaveTextContent('Not saved — try again.')
  })

  it('stays quiet about saving while the save is fine', () => {
    renderRow({ saveState: 'idle' })
    expect(screen.queryByText('Not saved — try again.')).not.toBeInTheDocument()
  })

  it('flags a clock past the end of the match without refusing it', () => {
    renderRow({ moment: moment({ matchClock: '11:00' }), gameLength: '09:30' })
    expect(screen.getByRole('status')).toHaveTextContent(
      '11:00 is longer than this match (09:30). Saved anyway — check the time.',
    )
  })

  it('does not flag a clock inside the match', () => {
    renderRow({ moment: moment({ matchClock: '04:12' }), gameLength: '09:30' })
    expect(screen.queryByText(/is longer than this match/)).not.toBeInTheDocument()
  })

  it('disables every control while writes are blocked, and says why', () => {
    renderRow({ blocked: true, blockedReason: 'A session is open', replayCode: 'AB12CD' })
    expect(screen.getByLabelText('What happened')).toBeDisabled()
    expect(screen.getByLabelText('Clock')).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Remove moment 1 of 3, at 04:12$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'comms' })).toBeDisabled()
    expect(screen.getByLabelText('What happened')).toHaveAttribute('title', 'A session is open')
  })

  it('asks to be removed', async () => {
    const { emitted } = renderRow()
    await fireEvent.click(screen.getByRole('button', { name: /^Remove moment 1 of 3, at 04:12$/ }))
    expect(emitted('remove')).toHaveLength(1)
  })

  it('starts an empty clock at 00:00 so the digits have somewhere to land', () => {
    renderRow({ moment: moment({ matchClock: '', text: '' }) })
    expect(screen.getByLabelText('Clock')).toHaveValue('00:00')
  })

  it('offers a way to attach the frame the moment is about', () => {
    renderRow()
    expect(screen.getByRole('button', { name: /^Attach a frame to moment 1 of 3/ })).toBeInTheDocument()
  })

  it('hands the chosen file up rather than uploading from a presentational row', async () => {
    const { emitted } = renderRow()
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    await fireEvent.drop(screen.getByRole('group', { name: /^Moment 1 of 3/ }), {
      dataTransfer: { files: [file], types: ['Files'] },
    })
    expect((emitted('attach') as File[][])[0]![0]).toBe(file)
  })

  it('ignores a drop that carries no file', async () => {
    // Dragging text or a link across the row must not read as an attachment.
    const { emitted } = renderRow()
    await fireEvent.drop(screen.getByRole('group', { name: /^Moment 1 of 3/ }), {
      dataTransfer: { files: [], types: ['text/plain'] },
    })
    expect(emitted('attach')).toBeUndefined()
  })

  it('refuses a dropped file that is not an image it can serve back', async () => {
    const { emitted } = renderRow()
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' })
    await fireEvent.drop(screen.getByRole('group', { name: /^Moment 1 of 3/ }), {
      dataTransfer: { files: [file], types: ['Files'] },
    })
    expect(emitted('attach')).toBeUndefined()
    expect(screen.getByRole('status')).toHaveTextContent(/PNG or JPEG/)
  })

  it('shows the attached frame, and a way to take it off', () => {
    renderRow({ moment: moment({ imageSHA256: 'a'.repeat(64) }) })
    expect(screen.getByRole('img', { name: /^Frame attached to moment 1 of 3/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Remove the frame from moment 1 of 3/ })).toBeInTheDocument()
  })

  it('detaches without deleting the moment', async () => {
    const { emitted } = renderRow({ moment: moment({ imageSHA256: 'a'.repeat(64) }) })
    await fireEvent.click(screen.getByRole('button', { name: /^Remove the frame/ }))
    expect((emitted('update') as CoachMoment[][])[0]![0]!.imageSHA256).toBe('')
    expect(emitted('remove')).toBeUndefined()
  })

  it('offers no attach control while writes are blocked', () => {
    renderRow({ blocked: true, blockedReason: 'A session is open' })
    expect(screen.getByRole('button', { name: /^Attach a frame/ })).toBeDisabled()
  })
})
