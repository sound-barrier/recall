import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import MatchStatusChoosers from '@/components/matches/detail/MatchStatusChoosers.vue'
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

// Queue, play mode and review status write per-match rows; the "filter from
// this match" anchor below them is a local view preference and must stay
// live even when writes are locked.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

function renderChoosers() {
  return render(MatchStatusChoosers, {
    props: {
      record: { match_key: 'match-2026-08-13T21-14-00', source_files: [], data: {} } as unknown as MatchRecord,
      anchorKey: '',
    },
  })
}

const radios = (group: string) => within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio')

describe('MatchStatusChoosers — the write gate', () => {
  beforeEach(resetWriteGate)

  it('leaves every chooser live when writes are open', () => {
    renderChoosers()
    for (const group of ['Match queue type', 'Match play mode', 'Match review status']) {
      for (const radio of radios(group)) expect(radio).toBeEnabled()
    }
  })

  it('disables all three radiogroups while writes are locked', () => {
    setWritesLocked(true, { session: true })
    renderChoosers()
    for (const group of ['Match queue type', 'Match play mode', 'Match review status']) {
      const found = radios(group)
      expect(found).toHaveLength(3)
      for (const radio of found) expect(radio).toBeDisabled()
    }
  })

  it('keeps the anchor toggle usable — it filters, it does not write', () => {
    setWritesLocked(true, { session: true })
    renderChoosers()
    expect(screen.getByRole('button', { name: /Filter from this match/ })).toBeEnabled()
  })
})
