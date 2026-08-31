import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import MatchDuplicateChip from '@/components/matches/shared/MatchDuplicateChip.vue'
import { useAppStore } from '@/stores/app'
import { useUiStore } from '@/stores/ui'

const TWIN = 'match-2026-05-10T18-05-22'

// The chip carries a judgment the user already made, and the only way to
// check a judgment about a PAIR is to look at both — so it is a button that
// goes there, not a label that states it.
describe('MatchDuplicateChip', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('names the match it points at, for anyone who cannot see the icon', () => {
    render(MatchDuplicateChip, { props: { duplicateOf: [TWIN] } })
    expect(screen.getByRole('button', { name: `Possible duplicate of ${TWIN}` })).toBeInTheDocument()
  })

  it('opens the twin', async () => {
    const ui = useUiStore()
    const reveal = vi.spyOn(ui, 'revealMatch').mockReturnValue(true)
    render(MatchDuplicateChip, { props: { duplicateOf: [TWIN] } })

    await userEvent.click(screen.getByRole('button', { name: /^Possible duplicate of/ }))
    expect(reveal).toHaveBeenCalledWith(TWIN)
    // Not `toBe('')` — the matches store's own boot fetch fails under the
    // unit-test network block and parks its message here. What matters is
    // that the chip added nothing of its own.
    expect(useAppStore().error).not.toMatch(/hidden/i)
  })

  // Hiding one of a pair is a reasonable thing to do — it is often the
  // answer to "these are the same match" — and the narrow drops hidden
  // records, so revealMatch cannot get there. A button that did nothing at
  // all would be worse than no button.
  it('says why it cannot open a twin that is hidden', async () => {
    const ui = useUiStore()
    vi.spyOn(ui, 'revealMatch').mockReturnValue(false)
    render(MatchDuplicateChip, { props: { duplicateOf: [TWIN] } })

    await userEvent.click(screen.getByRole('button', { name: /^Possible duplicate of/ }))
    expect(useAppStore().error).toMatch(/hidden/i)
  })

  it('renders one chip per twin', () => {
    render(MatchDuplicateChip, { props: { duplicateOf: [TWIN, 'match-2026-05-09T20-00-00'] } })
    expect(screen.getAllByRole('button', { name: /^Possible duplicate of/ })).toHaveLength(2)
  })
})
