import { describe, it, expect, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { useGameDataUpdate } from '@/composables/update/useGameDataUpdate'
import type { UpdateInfo } from '@/api-client'

vi.mock('@/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api-client')>()),
  ApplyGameDataUpdate: vi.fn(),
}))

function infoWith(gameData: Record<string, unknown>): UpdateInfo {
  return { game_data: { commit_sha: 'abc', applied_commit: '', has_update: true, ...gameData } } as unknown as UpdateInfo
}

describe('useGameDataUpdate — season diffs', () => {
  it('counts added and changed seasons and surfaces them in the manifest + summary', () => {
    const info = ref(infoWith({
      added_seasons: ['Reign of Talon — Season 4'],
      changed_seasons: ['Reign of Talon — Season 3'],
    }))
    const ow = useGameDataUpdate(info, ref(true), () => {})

    expect(ow.addedCount.value).toBe(1)
    expect(ow.changeCount.value).toBe(2) // 1 added + 1 changed

    const seasonRows = ow.diffRows.value.filter((r) => r.kind === 'Season')
    expect(seasonRows).toEqual([
      { kind: 'Season', sign: '+', name: 'Reign of Talon — Season 4' },
      { kind: 'Season', sign: '~', name: 'Reign of Talon — Season 3' },
    ])

    expect(ow.changeSummary.value).toContain('1 new season')
    expect(ow.changeSummary.value).toContain('1 season updated')
  })

  it('a changed-only update still reports a change (changed seasons aren\'t added/removed)', () => {
    const ow = useGameDataUpdate(ref(infoWith({ changed_seasons: ['S3'] })), ref(true), () => {})
    expect(ow.addedCount.value).toBe(0)
    expect(ow.removedCount.value).toBe(0)
    expect(ow.changeCount.value).toBe(1)
    expect(ow.changeSummary.value).toBe('1 season updated available')
  })
})

// Reopening the dialog re-armed Apply even while an apply was still running:
// Apply came back enabled mid-apply and a second press sent a second apply.
describe('useGameDataUpdate — one apply at a time', () => {
  it('a reopen mid-apply keeps the apply running, and a second press sends nothing', async () => {
    const { ApplyGameDataUpdate } = await import('@/api-client')
    let finish: () => void = () => {}
    vi.mocked(ApplyGameDataUpdate).mockReset()
    vi.mocked(ApplyGameDataUpdate).mockImplementation(() => new Promise((resolve) => {
      finish = () => { resolve({ commit_sha: 'abc' } as never) }
    }))
    const open = ref(true)
    const gd = useGameDataUpdate(ref(infoWith({})), open, () => {})

    void gd.onApply()
    open.value = false
    await nextTick()
    open.value = true
    await nextTick()

    expect(gd.applyState.value.kind).toBe('applying')
    void gd.onApply()
    expect(ApplyGameDataUpdate).toHaveBeenCalledTimes(1)
    finish()
    await new Promise((r) => setTimeout(r))
    expect(gd.applyState.value.kind).toBe('success')
  })
})
