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

function make(records: MatchRecord[] = [READY, BLOCKED], sessionActive = false) {
  onError = vi.fn<(raw: string) => void>()
  onSaved = vi.fn<(message: string) => void>()
  showMatches = vi.fn<(keys: string[], why: string) => void>()
  const deps: ShareWithCoachDeps = {
    records: ref(records), onError, onSaved, showMatches, sessionActive: () => sessionActive,
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

  // An empty set never gets a dialog at all: opening one over nothing is a
  // dead end, and the four doors disable at zero for the same reason.
  it('refuses to open over an empty set', () => {
    const share = make()
    share.requestShare([], 'selection')
    expect(share.shareOpen.value).toBe(false)
  })

  // The buttons disable during a session, but a disabled button is a
  // courtesy: the corpus on screen is the coach's loaned one, and sending it
  // on signed with the player's own handle is what must not happen.
  it('refuses to open, or to send, while a coaching session is live', async () => {
    const share = make([READY], true)
    share.requestShare(['m-1'], 'row')
    expect(share.shareOpen.value).toBe(false)
    await share.confirmShare(SUBMISSION)
    expect(exportBundle).not.toHaveBeenCalled()
  })

  // shareBusy is composable-scoped, so a send that settles after the user
  // dismissed and reopened over a NEW set used to close that second dialog
  // and wipe its keys.
  it('a settled send does not close a dialog opened after it', async () => {
    const share = make([READY])
    share.requestShare(['m-1'], 'row')
    const inFlight = share.confirmShare(SUBMISSION)
    share.closeShare()
    share.requestShare(['m-1'], 'selection')
    await inFlight
    expect(share.shareOpen.value).toBe(true)
    expect(share.shareKeys.value).toEqual(['m-1'])
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
    share.stashShareDraft({ handle: 'Sable', message: 'look at dorado' })
    await share.confirmShare(SUBMISSION)
    expect(onSaved).not.toHaveBeenCalled()
    // A dismissed picker is not a decision about the words.
    expect(share.shareDraft.value).toEqual({ handle: 'Sable', message: 'look at dorado' })
  })

  it('reports a refusal rather than swallowing it', async () => {
    exportBundle = vi.fn(async () => { throw new Error('409 share needs a replay code') })
    setApiBacking({ ExportBundle: exportBundle })
    const share = make([READY])
    share.requestShare(['m-1'], 'row')
    share.stashShareDraft({ handle: 'Sable', message: 'look at dorado' })
    await share.confirmShare(SUBMISSION)
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/replay code/))
    expect(share.shareOpen.value).toBe(false)
    // The refusal is exactly the retry path the draft exists for.
    expect(share.shareDraft.value).toEqual({ handle: 'Sable', message: 'look at dorado' })
  })

  it('lets the draft die only with a successful send or an explicit close', async () => {
    const share = make([READY])
    share.requestShare(['m-1'], 'row')
    share.stashShareDraft({ handle: 'Sable', message: 'look at dorado' })
    await share.confirmShare(SUBMISSION)
    expect(share.shareDraft.value).toBeNull()

    share.requestShare(['m-1'], 'row')
    share.stashShareDraft({ handle: 'Sable', message: 'second draft' })
    share.closeShare()
    expect(share.shareDraft.value).toBeNull()
  })

  it('puts the blockers on screen and gets out of the way', async () => {
    const share = make()
    share.requestShare(['m-1', 'm-2'], 'selection')
    await share.showMissingOnMatches()
    expect(showMatches).toHaveBeenCalledWith(['m-2'], 'matches missing a replay code')
    expect(share.shareOpen.value).toBe(false)
  })
})
