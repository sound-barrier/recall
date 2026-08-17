// Stats aggregations + numeric formatters used by the dossier and
// the matches workspace's aggregate strip. tallyWLD + WLDTally are
// also imported by the grouping helpers
// carries a W/L/D tally at every level.

import { parseGameLengthMinutes } from '@/match/match-time-helpers'

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
// Optional `skipAnnotated` flag drops any record carrying at least one
// `annotation.leavers` side from the tally. Used by the "Don't tally leaver
// matches" preference in the narrow panel — the matches still appear in the
// list, they just don't count toward the win-rate readouts. Throwers are
// deliberately NOT covered: a thrown match still counts.
function hasLeaver(r: { annotation?: { leavers?: string[] | null } | null }): boolean {
  return !!r.annotation?.leavers?.length
}

export function tallyWLD(
  records: {
    data?: { result?: string | null } | null
    annotation?: { leavers?: string[] | null } | null
  }[],
  skipAnnotated = false,
): WLDTally {
  let w = 0
  let l = 0
  let d = 0
  for (const r of records) {
    if (skipAnnotated && hasLeaver(r)) continue
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

// KDA = (eliminations + assists) / deaths, with deaths floored at 1 so
// a deathless game divides by one rather than exploding. Duration
// cancels out of the ratio, so it is already normalized without the
// per-10min fields. A present-but-partial stat line treats the missing
// stats as 0; a record carrying none of the three has no performance
// read at all and returns null (render as absent, never as 0).
export function kdaRatio(
  data: { eliminations?: number | null; assists?: number | null; deaths?: number | null } | null | undefined,
): number | null {
  if (data == null) return null
  const { eliminations, assists, deaths } = data
  if (eliminations == null && assists == null && deaths == null) return null
  return ((eliminations ?? 0) + (assists ?? 0)) / Math.max(1, deaths ?? 0)
}

// Table-cell rendering for a KDA ratio: at most two decimals with
// trailing zeros trimmed ("3.75", "10", "3.33"); empty for null so a
// stat-less row's cell stays blank in the TSV copy path.
export function formatKda(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return ''
  return String(Math.round(ratio * 100) / 100)
}

// Top-N value picker for a set of records. Walks the record list and
// counts via the picker; returns the most-common value plus its count,
// or null when no record produced a non-empty value. Used by the
// aggregate-stats panel to find "top hero" / "top map" over the
// filtered set. Ties resolve alphabetically so the readout is stable
// across reloads.
export interface Mode<T> { value: T; count: number }

// Ties resolve alphabetically so the readout is stable across reloads.
function tieBreakWins<T>(candidate: T, best: T | null): boolean {
  return best !== null
    && typeof candidate === 'string' && typeof best === 'string'
    && candidate < best
}

function pickMode<T>(counts: Map<T, number>): Mode<T> | null {
  let bestValue: T | null = null
  let bestCount = -1
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && tieBreakWins(v, bestValue))) {
      bestCount = c
      bestValue = v
    }
  }
  return bestValue === null ? null : { value: bestValue, count: bestCount }
}

export function modeOf<R, T>(records: R[], pick: (r: R) => T | null | undefined): Mode<T> | null {
  const counts = new Map<T, number>()
  for (const r of records) {
    const v = pick(r)
    if (v === null || v === undefined) continue
    if (typeof v === 'string' && v === '') continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return pickMode(counts)
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
