import { splitTrailingWindow } from '@/match/dossier/match-baseline-helpers'
import { sessionCount, type MomentumInput } from '@/match/dossier/match-momentum-helpers'

/**
 * Climb numbers denominated in SR rather than in the progress meter.
 *
 * Every rate the app already shows counts `data.change_percent`, because that
 * is what almost every rank screen reports. `data.sr[].change` is the real
 * currency and is read far less often — so these exist BESIDE the meter
 * widgets rather than replacing them, and they say "no SR readings" instead of
 * blanking a card that was working.
 *
 * SR is per-role in this game. A match can therefore carry one row per role
 * played, and the sum over rows is the movement of the MATCH; the readCount is
 * the number of MATCHES that reported anything, because that is the sample
 * size a reader is judging the number by.
 */

const DAYS_PER_WEEK = 7

export interface SRDelta {
  /** Signed SR across the window, or null when nothing reported any. */
  net: number | null
  /** Matches that reported at least one SR row. */
  readCount: number
  /** Matches in the window, so a surface can say "4 of 19 read". */
  readOf: number
}

/** Signed SR movement over the trailing `days`. */
export function srDelta(records: readonly MomentumInput[], days: number): SRDelta {
  const { recent } = splitTrailingWindow(records, days, 0)
  let sum = 0
  let read = 0
  for (const rec of recent) {
    const rows = rec.data?.sr ?? []
    const moved = rows.reduce((acc, r) => acc + (typeof r.change === 'number' ? r.change : 0), 0)
    if (rows.some((r) => typeof r.change === 'number')) {
      sum += moved
      read++
    }
  }
  return { net: read > 0 ? sum : null, readCount: read, readOf: recent.length }
}

export interface SRVelocity {
  perWeek: number | null
  perSession: number | null
  sessions: number
  readCount: number
}

/**
 * The climb rate in SR, in the units a player experiences.
 *
 * Both denominators come from the window that produced the sum — the same
 * correction the meter-denominated version needed, where a session count taken
 * over the whole history divided a month's movement by a year of sessions.
 */
export function srVelocity(records: readonly MomentumInput[], days: number): SRVelocity {
  const { recent } = splitTrailingWindow(records, days, 0)
  const { net, readCount } = srDelta(records, days)
  const sessions = sessionCount(recent)
  if (net === null) {
    return { perWeek: null, perSession: null, sessions, readCount: 0 }
  }
  const weeks = days / DAYS_PER_WEEK
  return {
    perWeek: weeks > 0 ? net / weeks : null,
    perSession: sessions > 0 ? net / sessions : null,
    sessions,
    readCount,
  }
}

export interface SRRoleRow {
  hero: string
  net: number
  /** The most recent SR reading for this hero — where they actually stand. */
  latest: number
  readCount: number
}

/**
 * SR movement split by the hero that earned it, newest reading kept.
 *
 * One number hides the case this exists for: a support climbing while a tank
 * slides. SR is banked per role, so a single net figure can be flat while both
 * halves moved.
 */
export function srPerRole(records: readonly MomentumInput[]): SRRoleRow[] {
  const byHero = new Map<string, SRRoleRow>()
  for (const rec of records) {
    for (const row of rec.data?.sr ?? []) {
      foldSRRow(byHero, row)
    }
  }
  return [...byHero.values()]
}

/** One SR row folded into the per-hero tally. Extracted so srPerRole stays
 *  one loop rather than a loop and a branch tree. */
function foldSRRow(into: Map<string, SRRoleRow>, row: { hero?: string; sr?: number; change?: number }): void {
  if (typeof row.change !== 'number' || !row.hero) return
  const prev = into.get(row.hero)
  into.set(row.hero, {
    hero: row.hero,
    net: (prev?.net ?? 0) + row.change,
    latest: typeof row.sr === 'number' ? row.sr : (prev?.latest ?? 0),
    readCount: (prev?.readCount ?? 0) + 1,
  })
}
