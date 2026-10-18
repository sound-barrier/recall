import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@/test-utils'

// The Parse tab's takeover row. Its contract: say how many of the folder's
// screenshots other profiles own, move them here only after a second click,
// keep the keyboard user's place through the two steps, and report what moved.
const { ClaimFolderScreenshots } = vi.hoisted(() => ({ ClaimFolderScreenshots: vi.fn() }))
vi.mock('@/api', () => ({ ClaimFolderScreenshots }))
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

import ClaimedElsewhereRow from '@/components/ingest/ClaimedElsewhereRow.vue'
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

beforeEach(() => {
  ClaimFolderScreenshots.mockReset()
  resetWriteGate()
})

const user = () => userEvent.setup()
const armButton = () => screen.queryByRole('button', { name: 'Move them here…' })
const confirmButton = () => screen.getByRole('button', { name: 'Confirm move' })

describe('ClaimedElsewhereRow', () => {
  it('renders nothing when no other profile owns any of the folder', () => {
    render(ClaimedElsewhereRow, { props: { count: 0 } })
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(armButton()).not.toBeInTheDocument()
  })

  it('says how many screenshots other profiles own', () => {
    render(ClaimedElsewhereRow, { props: { count: 4 } })
    expect(screen.getByText(/4 screenshots in this folder belong to other profiles/)).toBeInTheDocument()
  })

  it('uses the singular for one screenshot', () => {
    render(ClaimedElsewhereRow, { props: { count: 1 } })
    expect(screen.getByText(/1 screenshot in this folder belongs to another profile/)).toBeInTheDocument()
  })

  it('moves nothing on the first click; the second moves them and reports it', async () => {
    ClaimFolderScreenshots.mockResolvedValue({ screenshots: 4, matches_moved: 2 })
    render(ClaimedElsewhereRow, { props: { count: 4 } })

    await user().click(armButton()!)
    expect(screen.getByText('Matches built from them leave the other profiles and move here too.')).toBeInTheDocument()
    expect(ClaimFolderScreenshots).not.toHaveBeenCalled()

    await user().click(confirmButton())
    await flushPromises()

    expect(ClaimFolderScreenshots).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Moved 4 screenshots and 2 matches here.')
  })

  it('points at Run Parse when the screenshots came without matches', async () => {
    ClaimFolderScreenshots.mockResolvedValue({ screenshots: 1, matches_moved: 0 })
    render(ClaimedElsewhereRow, { props: { count: 1 } })

    await user().click(armButton()!)
    await user().click(confirmButton())
    await flushPromises()

    expect(screen.getByRole('status')).toHaveTextContent('Moved 1 screenshot here. Run Parse to read it.')
  })

  it('cancel disarms without moving anything', async () => {
    render(ClaimedElsewhereRow, { props: { count: 2 } })

    await user().click(armButton()!)
    await user().click(screen.getByRole('button', { name: 'Cancel' }))

    expect(armButton()).toBeInTheDocument()
    expect(ClaimFolderScreenshots).not.toHaveBeenCalled()
  })

  it('shows a failed move as an alert and stays armed', async () => {
    ClaimFolderScreenshots.mockRejectedValue(new Error('a parse is already in flight'))
    render(ClaimedElsewhereRow, { props: { count: 2 } })

    await user().click(armButton()!)
    await user().click(confirmButton())
    await flushPromises()

    expect(screen.getByRole('alert')).toHaveTextContent(/a parse is already in flight/)
    expect(confirmButton()).toBeEnabled()
  })

  it('arming hands focus to the confirm, and cancel hands it back', async () => {
    render(ClaimedElsewhereRow, { props: { count: 2 } })

    await user().click(armButton()!)
    await flushPromises()
    expect(confirmButton()).toHaveFocus()

    await user().click(screen.getByRole('button', { name: 'Cancel' }))
    await flushPromises()
    expect(armButton()).toHaveFocus()
  })

  it('a finished move leaves focus on the result, not the page', async () => {
    ClaimFolderScreenshots.mockResolvedValue({ screenshots: 2, matches_moved: 1 })
    render(ClaimedElsewhereRow, { props: { count: 2 } })

    await user().click(armButton()!)
    await user().click(confirmButton())
    await flushPromises()

    expect(screen.getByRole('status')).toHaveFocus()
  })

  it('locks with the reason while writes are locked', () => {
    setWritesLocked(true)
    render(ClaimedElsewhereRow, { props: { count: 2 } })
    expect(armButton()).toBeDisabled()
  })
})
