import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import type { MatchRecord } from '@/api-client'
import DetailPanelHeader from '@/components/matches/detail/DetailPanelHeader.vue'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

// The header carries the one write on this toolbar (the pin) and, during a
// coaching session, the one way OUT of a read-only match: the film room,
// where the coach's note about it actually goes.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

const KEY = 'match-2026-08-13T21-14-00'

function record(key = KEY): MatchRecord {
  return {
    match_key: key,
    source_files: ['a.png'],
    data: { map: "king's row", hero: 'ana', result: 'victory' },
  } as unknown as MatchRecord
}

function renderHeader(key = KEY) {
  setActivePinia(createPinia())
  return render(DetailPanelHeader, {
    props: {
      record: record(key),
      mapDisplay: "King's Row",
      provenanceSummary: '',
      canPrev: false,
      canNext: false,
      positionIndex: 1,
      positionTotal: 4,
    },
  })
}

const filmRoom = () => screen.queryByRole('button', { name: /Open in the film room/ })

describe('DetailPanelHeader', () => {
  beforeEach(resetWriteGate)

  it('offers no film-room hand-off outside a session', () => {
    renderHeader()
    expect(filmRoom()).toBeNull()
    expect(screen.getByRole('button', { name: 'Pin this match' })).toBeEnabled()
  })

  it('disables the pin while writes are locked', () => {
    setWritesLocked(true, { session: true })
    renderHeader()
    expect(screen.getByRole('button', { name: 'Pin this match' })).toBeDisabled()
  })

  it('hands the match to the film room during a session', async () => {
    setWritesLocked(true, { session: true })
    renderHeader()
    const coach = useCoachStore()
    const app = useAppStore()
    const selectKey = vi.spyOn(coach, 'selectKey')
    const goToView = vi.spyOn(app, 'goToView').mockResolvedValue(undefined)

    expect(filmRoom()).toBeInTheDocument()
    await userEvent.setup().click(filmRoom()!)
    expect(selectKey).toHaveBeenCalledWith(KEY)
    expect(goToView).toHaveBeenCalledWith('reviews')
  })

  // Design rule 7: the panel's own When cell reads the player's naive
  // clock during a session, and the strip is where this surface says so.
  // Design rule 6: a coach's note lives on a tracked key. Handing an
  // `unmatched-` sentinel to the desk would open an editor whose every
  // keystroke the server refuses — so the hand-off says why instead.
  it('refuses the film-room hand-off for a record that was never matched', () => {
    setWritesLocked(true, { session: true })
    renderHeader('unmatched-Zm9vLnBuZw')
    expect(filmRoom()).toBeDisabled()
    expect(screen.getByText(/never matched to a match/)).toBeInTheDocument()
  })

  it("names whose clock the panel is in during a session", () => {
    setWritesLocked(true, { session: true })
    renderHeader()
    expect(screen.getByText(/Times in .+'s clock/)).toBeInTheDocument()
  })

  it('says nothing about clocks outside a session', () => {
    renderHeader()
    expect(screen.queryByText(/Times in .+'s clock/)).toBeNull()
  })
})
