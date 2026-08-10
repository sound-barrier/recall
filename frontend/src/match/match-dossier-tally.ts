import type { MatchRecord } from '@/api-client'

// The dossier's shared W/L/D tally vocabulary. Every aggregation kernel
// in match-dossier-aggregate.ts classifies results through bumpTally and
// renders percentages through the helpers here, so the victory/defeat/
// draw ladder and the rounding conventions live in exactly one place.
//
// Two deliberate percentage conventions coexist (see BreakdownEntry in
// useMatchesDossier.types.ts): count-shaped breakdowns report 0 for a
// no-decisive bucket (winratePct), judgment-shaped consumers need null
// so "played but undecided" reads as no-sample (winrateOrNull). Both
// stay — do not unify them.

// One bucket's running result tally. `total` counts every classified
// call; w/l/d only the recognized results, so an unknown result still
// contributes volume without skewing the decisive rate.
export interface WldTally {
  total: number
  w: number
  l: number
  d: number
}

export function newTally(): WldTally {
  return { total: 0, w: 0, l: 0, d: 0 }
}

// Rolls one match result into a tally — the single home of the
// victory / defeat / draw if-ladder the kernels used to repeat.
export function bumpTally(tally: WldTally, result: string | undefined): void {
  tally.total++
  if (result === 'victory') tally.w++
  else if (result === 'defeat') tally.l++
  else if (result === 'draw') tally.d++
}

// The decisive-only sibling of bumpTally for buckets that never track
// draws or volume: only victory / defeat move the tally.
export function bumpDecisive(tally: { w: number; l: number }, result: string | undefined): void {
  if (result === 'victory') tally.w++
  else if (result === 'defeat') tally.l++
}

// Integer share of `part` over `whole`; 0 on an empty denominator so
// an empty breakdown renders flat bars instead of NaN.
export function sharePct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100)
}

// Winrate over decisive games (draws excluded — the house convention),
// reported as 0 when nothing was decisive. Count-shaped breakdown rows
// use this form.
export function winratePct(w: number, l: number): number {
  return w + l === 0 ? 0 : Math.round((w / (w + l)) * 100)
}

// Winrate over an explicit decisive count, null when there is none —
// a played-but-undecided bucket must read as no-sample rather than 0%.
export function winrateOrNull(w: number, decisive: number): number | null {
  return decisive === 0 ? null : Math.round((w / decisive) * 100)
}

// Trailing-window predicate for the 1M/3M/6M/12M toggles. `cutoff` is
// a YYYY-MM-DD string compared lexicographically against data.date; an
// empty cutoff means all-time. Records with no date drop out of any
// bounded window — they can't prove they belong to it.
export function inTrailingWindow(r: MatchRecord, cutoff: string): boolean {
  if (!cutoff) return true
  const d = r.data?.date
  return !!d && d >= cutoff
}
