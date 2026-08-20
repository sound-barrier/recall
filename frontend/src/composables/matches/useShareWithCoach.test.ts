import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { MatchRecord } from '@/api'
import { setApiBacking } from '@/api-client'
import { useShareWithCoach, type ShareWithCoachDeps } from '@/composables/matches/useShareWithCoach'
import { resetQueryClient } from '@/queries/client'

function rec(key: string, code?: string): MatchRecord {
  return {
    match_key: key,
    source_files: [],
    data: { map: 'rialto', date: '2026-08-18' },
    ...(code === undefined ? {} : { annotation: { replay_code: code } }),
  } as unknown as MatchRecord
}

const READY = rec('m-1', 'A1B2C3')
const BLOCKED = rec('m-2')

let exportBundle: ReturnType<typeof vi.fn>
let onError: (raw: string) => void
let onSaved: (message: string) => void
let showMatches: (keys: string[], why: string) => void

function make(records: MatchRecord[] = [READY, BLOCKED]) {
  onError = vi.fn<(raw: string) => void>()
  onSaved = vi.fn<(message: string) => void>()
  showMatches = vi.fn<(keys: string[], why: string) => void>()
  const deps: ShareWithCoachDeps = {
    records: ref(records), onError, onSaved, showMatches,
  }
  return useShareWithCoach(deps)
}

const SUBMISSION = { handle: 'Sable', message: 'ult timing', filename: 'recall-share.zip' }

describe('useShareWithCoach', () => {
  beforeEach(() => {
    resetQueryClient()
    exportBundle = vi.fn(async () => '/Users/sable/Downloads/recall-share.zip')
    setApiBacking({ ExportBundle: exportBundle })
  })

  it('opens over the keys it was handed, and says how they were chosen', () => {
    const share = make()
    share.requestShare(['m-1'], 'row')
    expect(share.shareOpen.value).toBe(true)
    expect(share.shareSubject.value).toBe('This match')

    share.requestShare(['m-1', 'm-2'], 'narrow')
    expect(share.shareSubject.value).toBe('2 matches — everything showing on Matches')

    share.requestShare(['m-1', 'm-2'], 'last-session')
    expect(share.shareSubject.value).toBe('Your last session — 2 matches')
  })

  it('names each match going out, and which of them blocks the send', () => {
    const share = make()
    share.requestShare(['m-1', 'm-2'], 'selection')
    expect(share.shareManifest.value.map((r) => r.matchKey)).toEqual(['m-1', 'm-2'])
    expect(share.shareMissing.value.map((r) => r.matchKey)).toEqual(['m-2'])
    expect(share.shareSummary.value).toBe('2 matches · 1 needs a replay code')
    expect(share.shareBlocked.value).toMatch(/no replay code/)
  })

  it('is ready when every match carries a code', () => {
    const share = make([READY])
    share.requestShare(['m-1'], 'row')
    expect(share.shareBlocked.value).toBeUndefined()
  })

  it('refuses an empty set', () => {
    const share = make()
    share.requestShare([], 'selection')
    expect(share.shareBlocked.value).toBe('Nothing selected to send.')
  })

  // Hidden matches were hidden on purpose and an unknown-map match is
  // unusable to a coach — and the server's replay gate validates only the
  // explicit keys, so a toggled-in extra would slip past it entirely.
  it('sends exactly the keys, never a toggled-in extra', async () => {
    const share = make([READY])
    share.requestShare(['m-1'], 'row')
    await share.confirmShare(SUBMISSION)

    expect(exportBundle).toHaveBeenCalledWith({
      matchKeys: ['m-1'],
      includeHidden: false,
      includeUnknown: false,
      filename: 'recall-share.zip',
      share: { handle: 'Sable', message: 'ult timing' },
    })
  })

  it('says where the file went, and closes', async () => {
    const share = make([READY])
    share.requestShare(['m-1'], 'row')
    await share.confirmShare(SUBMISSION)
    expect(onSaved).toHaveBeenCalledWith('Sent: /Users/sable/Downloads/recall-share.zip')
    expect(share.shareOpen.value).toBe(false)
  })

  // '' is the native save dialog being dismissed. Nothing was written, so
  // there is nothing to announce and no receipt to go stale.
  it('says nothing when the save dialog was dismissed', async () => {
    exportBundle = vi.fn(async () => '')
    setApiBacking({ ExportBundle: exportBundle })
    const share = make([READY])
    share.requestShare(['m-1'], 'row')
    await share.confirmShare(SUBMISSION)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('reports a refusal rather than swallowing it', async () => {
    exportBundle = vi.fn(async () => { throw new Error('409 share needs a replay code') })
    setApiBacking({ ExportBundle: exportBundle })
    const share = make([READY])
    share.requestShare(['m-1'], 'row')
    await share.confirmShare(SUBMISSION)
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/replay code/))
    expect(share.shareOpen.value).toBe(false)
  })

  it('puts the blockers on screen and gets out of the way', async () => {
    const share = make()
    share.requestShare(['m-1', 'm-2'], 'selection')
    await share.showMissingOnMatches()
    expect(showMatches).toHaveBeenCalledWith(['m-2'], 'matches missing a replay code')
    expect(share.shareOpen.value).toBe(false)
  })
})
