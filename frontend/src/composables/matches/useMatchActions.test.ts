import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useMatchActions } from '@/composables/matches/useMatchActions'
import { useMatchesStore } from '@/stores/matches'

// The post-mutation reload contract: a match edit refetches ONLY the
// records — the pending-screenshot count and the OCR-failure ledger can't
// change from an annotation/status write, so the old full-cluster reload
// paid two wasted GETs per edit.
const api = vi.hoisted(() => ({
  GetMatchResults:       vi.fn(async () => []),
  GetNewScreenshotCount: vi.fn(async () => 0),
  GetFailedFiles:        vi.fn(async () => []),
  SetMatchPin:           vi.fn(async () => undefined),
  SetMatchVisibility:    vi.fn(async () => undefined),
  HardDeleteMatch:       vi.fn(async () => undefined),
  MoveMatches:           vi.fn(async () => undefined),
}))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  ...api,
  EventsOn:       vi.fn(),
  EventsOff:      vi.fn(),
  GetActiveParse: vi.fn(async () => null),
  GetOWData:      vi.fn(async () => ({ heroes_by_role: {}, maps_by_game_mode: {}, screenshot_sources: [], seasons: [] })),
}))

beforeEach(async () => {
  setActivePinia(createPinia())
  useMatchesStore()
  // Let the boot-time observer fetches settle, then start counting fresh.
  await new Promise(r => setTimeout(r, 0))
  vi.clearAllMocks()
})

describe('useMatchActions — post-mutation reload scope', () => {
  it('a match edit refetches the records and nothing else', async () => {
    const { onSetMatchPinned } = useMatchActions()
    await onSetMatchPinned('match:x', true)

    expect(api.SetMatchPin).toHaveBeenCalledWith('match:x', true)
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).not.toHaveBeenCalled()
    expect(api.GetFailedFiles).not.toHaveBeenCalled()
  })

  it('a bulk archive op fans out the PUTs then reloads records once', async () => {
    const { onUnhideMatches } = useMatchActions()
    await onUnhideMatches(['k1', 'k2', 'k3'])

    expect(api.SetMatchVisibility).toHaveBeenCalledTimes(3)
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).not.toHaveBeenCalled()
  })

  // The server derives the pending count from files-on-disk minus DB rows,
  // so deleting (or moving away) a match RAISES it — these two need the
  // full cluster, unlike ordinary edits.
  it('hard-delete refetches the whole cluster (the pending count changes)', async () => {
    const { onHardDeleteMatch } = useMatchActions()
    await onHardDeleteMatch('match:x')

    expect(api.HardDeleteMatch).toHaveBeenCalledWith('match:x')
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).toHaveBeenCalledTimes(1)
  })

  it('move-to-profile refetches the whole cluster', async () => {
    const { onMoveMatches } = useMatchActions()
    await onMoveMatches(['k1'], 'alt')

    expect(api.MoveMatches).toHaveBeenCalledWith(['k1'], 'alt')
    expect(api.GetNewScreenshotCount).toHaveBeenCalledTimes(1)
  })
})
