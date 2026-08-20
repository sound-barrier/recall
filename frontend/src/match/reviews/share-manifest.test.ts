import { describe, expect, it } from 'vitest'

import type { MatchRecord } from '@/api'
import {
  missingReplayRows, shareManifestRows, shareSummaryLine,
} from '@/match/reviews/share-manifest'

function rec(key: string, over: Record<string, unknown> = {}): MatchRecord {
  return {
    match_key: key,
    source_files: [],
    data: { map: 'rialto', date: '2026-08-18' },
    ...over,
  } as unknown as MatchRecord
}

const WITH_CODE = rec('m-1', {
  data: { map: 'rialto', date: '2026-08-18' },
  annotation: { replay_code: 'A1B2C3' },
})
const NO_CODE = rec('m-2', { data: { map: 'ilios', date: '2026-08-19' } })

describe('shareManifestRows', () => {
  it('names each match and carries its code', () => {
    expect(shareManifestRows(['m-1'], [WITH_CODE])).toEqual([
      { matchKey: 'm-1', label: 'rialto · 2026-08-18', replayCode: 'A1B2C3' },
    ])
  })

  it('keeps the caller order', () => {
    const rows = shareManifestRows(['m-2', 'm-1'], [WITH_CODE, NO_CODE])
    expect(rows.map((r) => r.matchKey)).toEqual(['m-2', 'm-1'])
  })

  it('treats a whitespace-only code as no code at all', () => {
    const blank = rec('m-3', { annotation: { replay_code: '   ' } })
    expect(shareManifestRows(['m-3'], [blank])[0]!.replayCode).toBe('')
  })

  it('falls back to the key when the match says nothing about itself', () => {
    const bare = rec('m-4', { data: {} })
    expect(shareManifestRows(['m-4'], [bare])[0]!.label).toBe('m-4')
  })

  // Dropping it would send the share a match short, silently — and a match
  // nobody can look up is certainly not one anybody can prove has a code.
  it('keeps a key the record set cannot resolve, and counts it as missing', () => {
    const rows = shareManifestRows(['ghost'], [])
    expect(rows).toEqual([{ matchKey: 'ghost', label: 'ghost', replayCode: '' }])
    expect(missingReplayRows(rows)).toHaveLength(1)
  })
})

describe('shareSummaryLine', () => {
  it('counts the matches when every one is ready', () => {
    expect(shareSummaryLine(shareManifestRows(['m-1'], [WITH_CODE]))).toBe('1 match')
  })

  it('names the gap when there is one', () => {
    const rows = shareManifestRows(['m-1', 'm-2'], [WITH_CODE, NO_CODE])
    expect(shareSummaryLine(rows)).toBe('2 matches · 1 needs a replay code')
  })

  it('pluralizes the gap honestly', () => {
    const rows = shareManifestRows(['m-2', 'ghost'], [NO_CODE])
    expect(shareSummaryLine(rows)).toBe('2 matches · 2 need a replay code')
  })
})
