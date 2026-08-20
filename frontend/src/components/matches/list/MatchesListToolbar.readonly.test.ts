import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'

import MatchesListToolbar from '@/components/matches/list/MatchesListToolbar.vue'
import { resetWriteGate, setWritesLocked, STUB_LOCK_REASON } from '@/test-utils/writeGateStub'

// Add match + Import matches are writes: locked while a coaching session is
// open. The lock's own semantics are the gate's test; here the toolbar just
// has to obey it and say why.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

const props = {
  matchCount: 3,
  sortGroupOpen: false,
  sortGroupLabel: 'Newest',
  density: 'comfortable' as const,
  undatedCount: 0,
  grouped: false,
  shareTargetCount: 3,
}

describe('MatchesListToolbar — write gate', () => {
  beforeEach(resetWriteGate)

  it('disables Add match + Import matches and titles them with the reason', () => {
    setWritesLocked(true)
    render(MatchesListToolbar, { props })
    const addMatch = screen.getByRole('button', { name: 'Add match' })
    expect(addMatch).toBeDisabled()
    expect(screen.getByRole('button', { name: /Import/ })).toBeDisabled()
    expect(addMatch).toHaveAttribute('title', STUB_LOCK_REASON)
  })

  it('leaves both enabled when writes are open', () => {
    render(MatchesListToolbar, { props })
    expect(screen.getByRole('button', { name: 'Add match' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Import/ })).toBeEnabled()
  })
})
