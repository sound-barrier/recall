import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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
    const w = mount(MatchesListToolbar, { props })
    expect(w.find('[data-add-match]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-import-matches]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-add-match]').attributes('title')).toContain('read-only')
  })
})
