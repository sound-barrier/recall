import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@/test-utils'

// The Parse tab's takeover row. Its contract: say how many of the folder's
// screenshots other profiles own, take them only after a second click, and
// report what came across.
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
const takeButton = () => screen.queryByRole('button', { name: 'Take them' })

describe('ClaimedElsewhereRow', () => {
  it('renders nothing when no other profile owns any of the folder', () => {
    render(ClaimedElsewhereRow, { props: { count: 0 } })
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(takeButton()).not.toBeInTheDocument()
  })

  it('says how many screenshots other profiles own', () => {
    render(ClaimedElsewhereRow, { props: { count: 4 } })
    expect(screen.getByText(/4 screenshots in this folder belong to other profiles/)).toBeInTheDocument()
  })

  it('uses the singular for one screenshot', () => {
    render(ClaimedElsewhereRow, { props: { count: 1 } })
    expect(screen.getByText(/1 screenshot in this folder belongs to another profile/)).toBeInTheDocument()
  })

  it('takes nothing on the first click; the second moves them and reports it', async () => {
    ClaimFolderScreenshots.mockResolvedValue({ screenshots: 4, matches_moved: 2 })
    render(ClaimedElsewhereRow, { props: { count: 4 } })

    await user().click(takeButton()!)
    expect(screen.getByText('Their matches move to this profile and leave the others.')).toBeInTheDocument()
    expect(ClaimFolderScreenshots).not.toHaveBeenCalled()

    await user().click(screen.getByRole('button', { name: 'Move them here' }))
    await flushPromises()

    expect(ClaimFolderScreenshots).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Took 4 screenshots · 2 matches moved here.')
  })

  it('points at Run Parse when the screenshots came without matches', async () => {
    ClaimFolderScreenshots.mockResolvedValue({ screenshots: 1, matches_moved: 0 })
    render(ClaimedElsewhereRow, { props: { count: 1 } })

    await user().click(takeButton()!)
    await user().click(screen.getByRole('button', { name: 'Move them here' }))
    await flushPromises()

    expect(screen.getByRole('status')).toHaveTextContent('Took 1 screenshot. Run Parse to read it.')
  })

  it('cancel disarms without taking anything', async () => {
    render(ClaimedElsewhereRow, { props: { count: 2 } })

    await user().click(takeButton()!)
    await user().click(screen.getByRole('button', { name: 'Cancel' }))

    expect(takeButton()).toBeInTheDocument()
    expect(ClaimFolderScreenshots).not.toHaveBeenCalled()
  })

  it('shows a failed takeover as an alert and stays armed', async () => {
    ClaimFolderScreenshots.mockRejectedValue(new Error('a parse is already in flight'))
    render(ClaimedElsewhereRow, { props: { count: 2 } })

    await user().click(takeButton()!)
    await user().click(screen.getByRole('button', { name: 'Move them here' }))
    await flushPromises()

    expect(screen.getByRole('alert')).toHaveTextContent(/a parse is already in flight/)
    expect(screen.getByRole('button', { name: 'Move them here' })).toBeEnabled()
  })

  it('locks with the reason while writes are locked', () => {
    setWritesLocked(true)
    render(ClaimedElsewhereRow, { props: { count: 2 } })
    expect(takeButton()).toBeDisabled()
  })
})
