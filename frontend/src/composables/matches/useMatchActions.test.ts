import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useMatchActions } from '@/composables/matches/useMatchActions'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'
import type { MatchRecord } from '@/api-client'

// The post-mutation reload contract: a match edit refetches ONLY the
// records — the pending-screenshot count and the OCR-failure ledger can't
// change from an annotation/status write, so the old full-cluster reload
// paid two wasted GETs per edit.
const api = vi.hoisted(() => ({
  GetMatchResults:        vi.fn(async () => [] as unknown[]),
  GetNewScreenshotCount:  vi.fn(async () => 0),
  GetFailedFiles:         vi.fn(async () => []),
  GetIgnoredScreenshots:  vi.fn(async () => []),
  SetMatchPin:            vi.fn(async () => undefined),
  SetMatchVisibility:     vi.fn(async () => undefined),
  HardDeleteMatch:        vi.fn(async () => undefined),
  MoveMatches:            vi.fn(async () => undefined),
  SetMatchAnnotation:     vi.fn(async () => undefined),
  DeleteMatchAnnotation:  vi.fn(async () => undefined),
  IgnoreScreenshot:       vi.fn(async () => undefined),
  RevealScreenshotsDir:   vi.fn(async () => undefined),
  UpdateMatchData:        vi.fn(async () => undefined),
  ResetMatchData:         vi.fn(async () => undefined),
  SetMatchReview:         vi.fn(async () => undefined),
  SetMatchQueue:          vi.fn(async () => undefined),
  SetMatchPlayMode:       vi.fn(async () => undefined),
  BulkSetMatchPlayMode:   vi.fn(async () => undefined),
  BulkSetMatchQueue:      vi.fn(async () => undefined),
  ResolveAmbiguousMatch:  vi.fn(async () => undefined),
}))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  ...api,
  EventsOn:       vi.fn(),
  EventsOff:      vi.fn(),
  GetActiveParse: vi.fn(async () => null),
  GetOWData:      vi.fn(async () => ({ heroes_by_role: {}, maps_by_game_mode: {}, screenshot_sources: [], seasons: [], ranks: [] })),
}))

// The write gate is stubbed so a locked run is a switch, not a whole
// profiles/session fixture; its own contract lives in useWriteGate.test.ts.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

type Actions = ReturnType<typeof useMatchActions>
type Annotation = NonNullable<MatchRecord['annotation']>

function rec(key: string, data: Record<string, unknown> = {}, annotation?: Partial<Annotation>): MatchRecord {
  return { match_key: key, source_files: [], data, annotation } as unknown as MatchRecord
}

// Seeds the records cache BEFORE the store's observers exist (so the boot
// fetch can't clobber the fixture), lets the observers settle, then starts
// counting api calls from zero.
async function boot(records: MatchRecord[] = []) {
  api.GetMatchResults.mockResolvedValue(records)
  seedQuery(qk.matches, records)
  useMatchesStore()
  await new Promise(r => setTimeout(r, 0))
  vi.clearAllMocks()
  return useMatchActions()
}

let writeText: ReturnType<typeof vi.fn>
beforeEach(() => {
  setActivePinia(createPinia())
  writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('useMatchActions — post-mutation reload scope', () => {
  it('a match edit refetches the records and nothing else', async () => {
    const { onSetMatchPinned } = await boot()
    await onSetMatchPinned('match:x', true)

    expect(api.SetMatchPin).toHaveBeenCalledWith('match:x', true)
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).not.toHaveBeenCalled()
    expect(api.GetFailedFiles).not.toHaveBeenCalled()
  })

  it('a bulk archive op fans out the PUTs then reloads records once', async () => {
    const { onUnhideMatches } = await boot()
    await onUnhideMatches(['k1', 'k2', 'k3'])

    expect(api.SetMatchVisibility).toHaveBeenCalledTimes(3)
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).not.toHaveBeenCalled()
  })

  // The server derives the pending count from files-on-disk minus DB rows,
  // so deleting (or moving away) a match RAISES it — these two need the
  // full cluster, unlike ordinary edits.
  it('hard-delete refetches the whole cluster (the pending count changes)', async () => {
    const { onHardDeleteMatch } = await boot()
    await onHardDeleteMatch('match:x')

    expect(api.HardDeleteMatch).toHaveBeenCalledWith('match:x')
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).toHaveBeenCalledTimes(1)
  })

  it('move-to-profile refetches the whole cluster', async () => {
    const { onMoveMatches } = await boot()
    await onMoveMatches(['k1'], 'alt')

    expect(api.MoveMatches).toHaveBeenCalledWith(['k1'], 'alt')
    expect(api.GetNewScreenshotCount).toHaveBeenCalledTimes(1)
  })

  // Suppressing a file leaves the pending count AND the failure ledger, so
  // this one also refreshes the ignore list itself.
  it('ignoring a screenshot refreshes the suppress list and the whole cluster', async () => {
    const { onIgnoreScreenshot } = await boot()
    await onIgnoreScreenshot('2026-08-01_scoreboard.png')

    expect(api.IgnoreScreenshot).toHaveBeenCalledWith('2026-08-01_scoreboard.png')
    expect(api.GetIgnoredScreenshots).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).toHaveBeenCalledTimes(1)
  })

  // Every remaining status/data write must stay NARROW. A handler that
  // quietly swapped reload() for the cluster would cost two wasted GETs on
  // every edit — invisible in the UI, and exactly the regression this
  // table exists to catch. New handler → new row here.
  const NARROW_WRITES = [
    { name: 'update match data', run: (a: Actions) => a.onUpdateMatchData('k1', { map: 'Ilios' }), fn: api.UpdateMatchData },
    { name: 'reset match data', run: (a: Actions) => a.onResetMatchData('k1'), fn: api.ResetMatchData },
    { name: 'set review', run: (a: Actions) => a.onSetMatchReview('k1', 'self'), fn: api.SetMatchReview },
    { name: 'set queue', run: (a: Actions) => a.onSetMatchQueue('k1', 'role'), fn: api.SetMatchQueue },
    { name: 'set play mode', run: (a: Actions) => a.onSetMatchPlayMode('k1', 'competitive'), fn: api.SetMatchPlayMode },
    { name: 'bulk play mode', run: (a: Actions) => a.onBulkPlayMode(['k1', 'k2'], 'competitive'), fn: api.BulkSetMatchPlayMode },
    { name: 'bulk queue', run: (a: Actions) => a.onBulkQueue(['k1', 'k2'], 'open'), fn: api.BulkSetMatchQueue },
    { name: 'resolve ambiguous', run: (a: Actions) => a.onResolveAmbiguous('ambiguous-1', 'k1'), fn: api.ResolveAmbiguousMatch },
  ]

  it.each(NARROW_WRITES)('$name refetches only the records', async ({ run, fn }) => {
    const actions = await boot([rec('k1')])
    await run(actions)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).not.toHaveBeenCalled()
    expect(api.GetFailedFiles).not.toHaveBeenCalled()
  })

  it('bulk hard-delete fans out the DELETE calls and refetches the whole cluster', async () => {
    const { onHardDeleteMatches } = await boot([rec('k1'), rec('k2')])
    await onHardDeleteMatches(['k1', 'k2'])

    expect(api.HardDeleteMatch).toHaveBeenCalledTimes(2)
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).toHaveBeenCalledTimes(1)
  })

  it('an empty selection touches neither the api nor the cache', async () => {
    const actions = await boot()
    await actions.onHideMatches([])
    await actions.onUnhideMatches([])
    await actions.onHardDeleteMatches([])
    await actions.onMoveMatches([], 'alt')
    await actions.onBulkTag([], 'stack')

    expect(api.SetMatchVisibility).not.toHaveBeenCalled()
    expect(api.GetMatchResults).not.toHaveBeenCalled()
  })
})

// PUT /annotation is upsert-only and rejects an all-empty body, so an edit
// that leaves nothing behind has to clear the row with DELETE instead.
describe('useMatchActions — annotation write shape', () => {
  const EMPTY = { leavers: [], throwers: [], note: '', replay_code: '', members: [], tags: [] }

  it('an edit that empties every field DELETE calls the annotation', async () => {
    const { onSetMatchAnnotation } = await boot([rec('k1')])
    await onSetMatchAnnotation('k1', EMPTY)

    expect(api.DeleteMatchAnnotation).toHaveBeenCalledWith('k1')
    expect(api.SetMatchAnnotation).not.toHaveBeenCalled()
  })

  it('whitespace-only members and tags are not content', async () => {
    const { onSetMatchAnnotation } = await boot([rec('k1')])
    await onSetMatchAnnotation('k1', { ...EMPTY, members: ['  '], tags: [''] })

    expect(api.DeleteMatchAnnotation).toHaveBeenCalledWith('k1')
  })

  it('one populated field is enough to PUT', async () => {
    const { onSetMatchAnnotation } = await boot([rec('k1')])
    await onSetMatchAnnotation('k1', { ...EMPTY, note: '  ganked mid  ' })

    expect(api.SetMatchAnnotation).toHaveBeenCalledWith('k1', expect.objectContaining({ note: '  ganked mid  ' }))
    expect(api.DeleteMatchAnnotation).not.toHaveBeenCalled()
  })

  // The editor's "saved ✓" pulse is a persistence receipt keyed on this
  // boolean — a failed write that reported true would show a false receipt.
  it('reports the outcome so the editor can withhold its saved pulse', async () => {
    const { onSetMatchAnnotation } = await boot([rec('k1')])
    await expect(onSetMatchAnnotation('k1', { ...EMPTY, note: 'ok' })).resolves.toBe(true)

    api.SetMatchAnnotation.mockRejectedValueOnce(new Error('disk full'))
    vi.clearAllMocks()
    await expect(onSetMatchAnnotation('k1', { ...EMPTY, note: 'nope' })).resolves.toBe(false)

    expect(useAppStore().error).toContain('disk full')
    expect(api.GetMatchResults).not.toHaveBeenCalled() // nothing to reload
  })

  it('setting one disruption side carries every other annotation field through', async () => {
    const existing: Partial<Annotation> = { throwers: ['enemy'], note: 'kept', replay_code: 'AB12CD', members: ['Ana'], tags: ['stack'] }
    const { onSetDisruptionAnnotation } = await boot([rec('k1', {}, existing)])
    await onSetDisruptionAnnotation('k1', 'leavers', ['team'])

    expect(api.SetMatchAnnotation).toHaveBeenCalledWith('k1', {
      leavers: ['team'],
      throwers: ['enemy'],
      note: 'kept',
      replay_code: 'AB12CD',
      members: ['Ana'],
      tags: ['stack'],
    })
  })

  it('clearing the only disruption side deletes the now-empty annotation', async () => {
    const { onSetDisruptionAnnotation } = await boot([rec('k1', {}, { leavers: ['team'] })])
    await onSetDisruptionAnnotation('k1', 'leavers', [])

    expect(api.DeleteMatchAnnotation).toHaveBeenCalledWith('k1')
  })
})

describe('useMatchActions — bulk tag', () => {
  it('normalizes the tag, carries the existing annotation, and skips an already-tagged match', async () => {
    const { onBulkTag } = await boot([
      rec('k1', {}, { note: 'kept', members: ['Ana'], tags: ['old'] }),
      rec('k2', {}, { tags: ['stack'] }),
    ])
    await onBulkTag(['k1', 'k2'], '  Stack  ')

    expect(api.SetMatchAnnotation).toHaveBeenCalledTimes(1)
    expect(api.SetMatchAnnotation).toHaveBeenCalledWith('k1', expect.objectContaining({
      note: 'kept',
      members: ['Ana'],
      tags: ['old', 'stack'],
    }))
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1) // one reload for the whole fan-out
  })

  it('a blank tag is not a tag', async () => {
    const { onBulkTag } = await boot([rec('k1')])
    await onBulkTag(['k1'], '   ')

    expect(api.SetMatchAnnotation).not.toHaveBeenCalled()
    expect(api.GetMatchResults).not.toHaveBeenCalled()
  })
})

// Hiding moves a match into the archive drawer, which is easy to miss — the
// undo toast is the closing half of that loop, and its label has to be read
// off the record BEFORE the reload drops it.
describe('useMatchActions — hide and its undo toast', () => {
  it('a single hide is labeled with the match date and map', async () => {
    const { onSetMatchHidden } = await boot([rec('k1', { date: '2026-08-01', map: 'Rialto' })])
    await onSetMatchHidden('k1', true)

    expect(api.SetMatchVisibility).toHaveBeenCalledWith('k1', true)
    expect(useUiStore().undoHideToast).toMatchObject({ matchKeys: ['k1'], label: '2026-08-01 · Rialto' })
  })

  it('falls back to the map alone when the match has no date', async () => {
    const { onSetMatchHidden } = await boot([rec('k1', { map: 'Ilios' })])
    await onSetMatchHidden('k1', true)

    expect(useUiStore().undoHideToast?.label).toBe('Ilios')
  })

  it('a bulk hide is labeled with the count; unhiding offers no undo', async () => {
    const actions = await boot([rec('k1', { map: 'Ilios' }), rec('k2', { map: 'Busan' })])
    await actions.onHideMatches(['k1', 'k2'])
    expect(useUiStore().undoHideToast?.label).toBe('2 matches')

    useUiStore().onUndoHideDismiss(useUiStore().undoHideToast!.token)
    await actions.onSetMatchHidden('k1', false)
    expect(useUiStore().undoHideToast).toBeNull()
  })
})

describe('useMatchActions — clipboard and error surfacing', () => {
  it('copying a replay code trims it, and refuses when the match has none', async () => {
    const { onCopyReplayCode } = await boot([
      rec('k1', {}, { replay_code: ' AB12CD ' }),
      rec('k2'),
    ])
    await onCopyReplayCode('k1')
    expect(writeText).toHaveBeenCalledWith('AB12CD')

    await onCopyReplayCode('k2')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(useAppStore().error).toBe('No replay code on this match.')
  })

  it('copying the match link puts the key on the clipboard', async () => {
    const { onCopyMatchLink } = await boot([rec('k1')])
    await onCopyMatchLink('k1')

    expect(writeText).toHaveBeenCalledWith('k1')
  })

  it('a denied clipboard surfaces the failure instead of silently dropping it', async () => {
    const { onCopyMatchLink } = await boot([rec('k1')])
    writeText.mockRejectedValueOnce(new Error('clipboard blocked'))
    await onCopyMatchLink('k1')

    expect(useAppStore().error).toContain('clipboard blocked')
  })

  it('a failed status write surfaces the error and skips the reload', async () => {
    const { onSetMatchPinned } = await boot([rec('k1')])
    api.SetMatchPin.mockRejectedValueOnce(new Error('database is locked'))
    await onSetMatchPinned('k1', true)

    expect(useAppStore().error).toContain('database is locked')
    expect(api.GetMatchResults).not.toHaveBeenCalled()
  })

  it('a failed reveal of the screenshots folder tells the user', async () => {
    const { onOpenSourceFolder } = await boot([rec('k1')])
    await onOpenSourceFolder('k1')
    expect(api.RevealScreenshotsDir).toHaveBeenCalledTimes(1)

    api.RevealScreenshotsDir.mockRejectedValueOnce(new Error('no such directory'))
    await onOpenSourceFolder('k1')
    expect(useAppStore().error).toContain('no such directory')
  })
})

describe('useMatchActions — the write gate', () => {
  beforeEach(resetWriteGate)

  it('sends nothing while writes are locked — the disabled buttons are only the polite half', async () => {
    const actions = await boot([rec('k1')])
    setWritesLocked(true, { session: true })

    await actions.onSetMatchPinned('k1', true)
    await actions.onSetMatchHidden('k1', true)
    await actions.onSetMatchReview('k1', 'self')
    await actions.onSetMatchQueue('k1', 'role')
    await actions.onSetMatchPlayMode('k1', 'competitive')
    await actions.onSetMatchAnnotation('k1', { note: 'no' })
    await actions.onUpdateMatchData('k1', {})
    await actions.onResetMatchData('k1')
    await actions.onHardDeleteMatch('k1')
    await actions.onHideMatches(['k1'])
    await actions.onBulkTag(['k1'], 'tilted')
    await actions.onMoveMatches(['k1'], 'other')
    await actions.onIgnoreScreenshot('a.png')
    await actions.onResolveAmbiguous('ambiguous-a.png', 'k1')

    for (const call of Object.values(api)) {
      if (call === api.GetMatchResults || call === api.GetNewScreenshotCount) continue
      if (call === api.GetFailedFiles || call === api.GetIgnoredScreenshots) continue
      expect(call).not.toHaveBeenCalled()
    }
  })

  it('reports the annotation write as NOT saved so the journal cannot flash a false receipt', async () => {
    const { onSetMatchAnnotation } = await boot([rec('k1')])
    setWritesLocked(true)
    await expect(onSetMatchAnnotation('k1', { note: 'no' })).resolves.toBe(false)
  })

  it('still copies and reveals — those read', async () => {
    const { onCopyMatchLink, onOpenSourceFolder } = await boot([rec('k1')])
    setWritesLocked(true, { session: true })
    await onCopyMatchLink('k1')
    await onOpenSourceFolder('k1')
    expect(writeText).toHaveBeenCalledWith('k1')
    expect(api.RevealScreenshotsDir).toHaveBeenCalled()
  })
})
