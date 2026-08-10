import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import { ref } from 'vue'

// A read-only active profile disables the write affordances in the toolbar.
vi.mock('@/composables/shared/useActiveProfile', () => ({
  useActiveProfile: () => ({ isReadOnly: ref(true), activeName: ref('test'), reloadActiveProfile: vi.fn() }),
}))

import MatchesListToolbar from '@/components/matches/list/MatchesListToolbar.vue'

const props = {
  matchCount: 3,
  sortGroupOpen: false,
  sortGroupLabel: 'Newest',
  density: 'comfortable' as const,
  undatedCount: 0,
  grouped: false,
}

describe('MatchesListToolbar — read-only profile', () => {
  it('disables Add match + Import matches', () => {
    render(MatchesListToolbar, { props })
    const addMatch = screen.getByRole('button', { name: 'Add match' })
    expect(addMatch).toBeDisabled()
    expect(screen.getByRole('button', { name: /Import/ })).toBeDisabled()
    expect(addMatch).toHaveAttribute('title', expect.stringContaining('read-only'))
  })
})
