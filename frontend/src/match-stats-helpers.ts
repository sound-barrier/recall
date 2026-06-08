// Stats aggregations + numeric formatters used by the dossier and
// the matches workspace's aggregate strip. tallyWLD + WLDTally are
// also imported by match-group-helpers.ts — the grouping tree
// carries a W/L/D tally at every level.

import { parseGameLengthMinutes } from './match-time-helpers'

export interface WLDTally {
  w: number
  l: number
  d: number
}

// tallyWLD counts wins / losses / draws case-insensitively. Records
// whose `data.result` is empty, missing, or anything other than
// victory/defeat/draw are silently ignored — partial rolls are fine
// (W+L+D ≤ length).
//
// Optional `skipAnnotated` flag drops any record that carries a
// non-empty `annotation.leaver` from the tally. Used by the
// "Don't tally leaver matches" preference on the FilterRail — the
// matches still appear in the list, they just don't count toward
// the win-rate readouts.
export function tallyWLD(
  records: {
    data?: { result?: string | null } | null
    annotation?: { leaver?: string | null } | null
  }[],
  skipAnnotated = false,
): WLDTally {
  let w = 0
  let l = 0
  let d = 0
  for (const r of records) {
    if (skipAnnotated && r.annotation && r.annotation.leaver) continue
    const result = (r.data?.result ?? '').toLowerCase()
    if (result === 'victory') w++
    else if (result === 'defeat') l++
    else if (result === 'draw') d++
  }
  return { w, l, d }
}

// Round-half-away-from-zero to two decimal places and render as
// "N.NN" with trailing zeros preserved. The naive
// `n.toFixed(2)` rounds against the IEEE 754 representation: 12.135
// is stored as 12.134999…, so `(12.135).toFixed(2)` yields "12.13"
// — surprising to a user who entered a clean decimal. The 1e-10
// shift nudges values past the boundary without affecting genuinely
// sub-boundary numbers (12.134999 → 12.13 still).
//
// Returns "—" for null / undefined / non-finite inputs (parity with
// the other formatters in this file).
export function formatToHundredths(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const epsilon = n >= 0 ? 1e-10 : -1e-10
  return (Math.round((n + epsilon) * 100) / 100).toFixed(2)
}

// Top-N value picker for a set of records. Walks the record list and
// counts via the picker; returns the most-common value plus its count,
// or null when no record produced a non-empty value. Used by the
// aggregate-stats panel to find "top hero" / "top map" over the
// filtered set. Ties resolve alphabetically so the readout is stable
// across reloads.
export interface Mode<T> { value: T; count: number }
export function modeOf<R, T>(records: R[], pick: (r: R) => T | null | undefined): Mode<T> | null {
  const counts = new Map<T, number>()
  for (const r of records) {
    const v = pick(r)
    if (v === null || v === undefined) continue
    if (typeof v === 'string' && v === '') continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  let bestValue: T | null = null
  let bestCount = -1
  for (const [v, c] of counts) {
    if (c > bestCount) {
      bestCount = c
      bestValue = v
    } else if (c === bestCount && bestValue !== null
      && typeof v === 'string' && typeof bestValue === 'string'
      && v < bestValue) {
      bestValue = v
    }
  }
  return bestValue === null ? null : { value: bestValue, count: bestCount }
}

// Mean of game_length across records that have one parseable. Returns
// null when no record contributes a value — callers render null as "—"
// rather than collapsing to 0:00 (which would be a lie about the data).
export function avgGameLengthMinutes(records: { data?: { game_length?: string | null } | null }[]): number | null {
  let sum = 0
  let n = 0
  for (const r of records) {
    const m = parseGameLengthMinutes(r.data?.game_length)
    if (m === null) continue
    sum += m
    n++
  }
  return n === 0 ? null : sum / n
}
