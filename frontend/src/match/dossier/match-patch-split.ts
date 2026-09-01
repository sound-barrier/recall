import type { MatchRecord } from '@/api-client'
import type { RateSample } from '@/match/dossier/match-momentum-helpers'
import { matchStartUTC } from '@/match/match-season-helpers'

/**
 * "I was good before the nerf" — the same set, split at a patch.
 *
 * The patch it splits on is the NEWEST one the set actually straddles, not
 * simply the newest one that exists. Splitting on a patch every match predates
 * would put the whole history on one side and present it as a comparison, and
 * the number would be about nothing.
 *
 * A match is placed by its START instant in UTC, exactly as season assignment
 * places it — the boundaries ARE season starts, so the two must agree or the
 * same match sits before the boundary in the Compare tab and after it here.
 * The naive wall clock does not agree: it is the player's local time with no
 * offset, so a coach's corpus, or a player who has moved timezone, lands games
 * on the wrong side of a boundary they were nowhere near.
 */

export interface PatchRef {
  name: string
  at: string
  note?: string
}

export interface PatchSplit {
  /** The patch the comparison is about, or null when none divides the set. */
  patch: PatchRef | null
  before: RateSample
  after: RateSample
}

/** Win rate before and after the newest patch this set straddles. */
export function splitByPatch(
  records: readonly MatchRecord[],
  patches: readonly PatchRef[],
): PatchSplit {
  const timed: { t: number; result: string | undefined }[] = []
  for (const r of records) {
    const t = matchStartUTC(r)
    if (t !== null) timed.push({ t, result: r.data?.result })
  }
  const chosen = newestStraddled(timed, patches)
  if (!chosen) {
    return { patch: null, before: rate(0, 0), after: rate(0, 0) }
  }
  const cut = Date.parse(chosen.at)
  const before = { wins: 0, n: 0 }
  const after = { wins: 0, n: 0 }
  for (const m of timed) {
    if (m.result !== 'victory' && m.result !== 'defeat') continue
    const side = m.t < cut ? before : after
    side.n++
    if (m.result === 'victory') side.wins++
  }
  return { patch: chosen, before: rate(before.wins, before.n), after: rate(after.wins, after.n) }
}

/**
 * The newest patch with matches on BOTH sides, falling back to the newest that
 * has anything after it.
 *
 * The fallback matters for the ordinary case: a player who started this season
 * has nothing before it, and the honest answer is an empty "before" attributed
 * to the right patch — not silence, and not a split on a patch from last year
 * that would make their whole history look post-change.
 */
function newestStraddled(
  timed: readonly { t: number }[],
  patches: readonly PatchRef[],
): PatchRef | null {
  const sorted = [...patches].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  let fallback: PatchRef | null = null
  for (const p of sorted) {
    const cut = Date.parse(p.at)
    if (Number.isNaN(cut)) continue
    const after = timed.some((m) => m.t >= cut)
    if (!after) continue
    if (timed.some((m) => m.t < cut)) return p
    fallback ??= p
  }
  return fallback
}

function rate(wins: number, sample: number): RateSample {
  return { winrate: sample > 0 ? Math.round((wins / sample) * 100) : null, sample }
}
