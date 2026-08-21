// What is actually going to the coach, row by row.
//
// A coach reviews by watching the replay, so a match with no replay code is
// a match they cannot act on — the server refuses the whole share for one
// (pkg/app: ErrShareNeedsReplayCode). The old dialog reported that as a
// count in a red box; a manifest names WHICH, which is the difference
// between a refusal and an instruction.

import type { MatchRecord } from '@/api'
import { pluralize } from '@/match/match-label-helpers'

export interface ShareManifestRow {
  matchKey: string
  /** "rialto · 2026-08-18", or the key when the match says nothing else. */
  label: string
  /** '' when the match carries no code — the thing that blocks the share. */
  replayCode: string
}

function codeOf(record: MatchRecord | undefined): string {
  return (record?.annotation?.replay_code ?? '').trim()
}

function labelOf(record: MatchRecord | undefined, matchKey: string): string {
  const parts = [record?.data?.map, record?.data?.date].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : matchKey
}

/**
 * One row per key, in the order the caller resolved them.
 *
 * A key the record set cannot resolve still gets a row, labeled by its key
 * and carrying no code. Dropping it would be the worse failure: the share
 * would go out a match short, silently, and a match nobody can look up is
 * certainly not one anybody can prove has a replay code.
 */
export function shareManifestRows(
  matchKeys: readonly string[],
  records: readonly MatchRecord[],
): ShareManifestRow[] {
  const byKey = new Map(records.map((r) => [r.match_key, r]))
  return matchKeys.map((matchKey) => {
    const record = byKey.get(matchKey)
    return { matchKey, label: labelOf(record, matchKey), replayCode: codeOf(record) }
  })
}

/** The rows blocking the share. */
export function missingReplayRows(rows: readonly ShareManifestRow[]): ShareManifestRow[] {
  return rows.filter((row) => row.replayCode === '')
}

/** "12 matches · 3 need a replay code" — the line above the list. */
export function shareSummaryLine(rows: readonly ShareManifestRow[]): string {
  const total = pluralize(rows.length, 'match', 'matches')
  const missing = missingReplayRows(rows).length
  if (missing === 0) return total
  return `${total} · ${missing} need${missing === 1 ? 's' : ''} a replay code`
}
