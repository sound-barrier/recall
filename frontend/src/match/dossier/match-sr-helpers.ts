import type { HeroSr } from '@/api-client'
import { splitTrailingWindow } from '@/match/dossier/match-baseline-helpers'
import { sessionCount, type MomentumInput } from '@/match/dossier/match-momentum-helpers'
import { matchEpoch } from '@/match/trends/match-trends-helpers'

/**
 * Climb numbers denominated in SR rather than in the progress meter.
 *
 * Every rate the app already shows counts `data.change_percent`, because that
 * is what almost every rank screen reports. `data.sr[].change` is the real
 * currency and is read far less often — so these exist BESIDE the meter
 * widgets rather than replacing them, and they say "no SR readings" instead of
 * blanking a card that was working.
 *
 * `change` is OPTIONAL on the wire, and that is what makes "no readings"
 * expressible at all: it used to be a bare int, so an unread pill arrived as 0
 * and every helper here counted it as measured flatness. Nineteen of the forty
 * SR captures in the corpus were that 0.
 *
 * Overwatch banks SR per HERO — a rank screen reports one card per hero
 * played, each with its own number — so the sum over a match's rows is the
 * movement of the MATCH, and readCount is the number of MATCHES that reported
 * anything, because that is the sample a reader judges the number by.
 */

const DAYS_PER_WEEK = 7

// How many heroes the by-hero split lists. A rank screen names every hero
// played, so a wide pool would otherwise grow the tile without bound; the
// tail is heroes with one or two readings, which is noise at this resolution.
const TOP_HEROES = 6

export interface SRDelta {
  /** Signed SR across the window, or null when nothing reported any. */
  net: number | null
  /** Matches that reported at least one SR reading. */
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
    const moved = readChanges(rec.data?.sr)
    if (moved === null) continue
    sum += moved
    read++
  }
  return { net: read > 0 ? sum : null, readCount: read, readOf: recent.length }
}

// The SR one match moved, or null when not one of its rows carried a reading.
function readChanges(rows: readonly HeroSr[] | undefined): number | null {
  let sum = 0
  let any = false
  for (const row of rows ?? []) {
    if (typeof row.change !== 'number') continue
    sum += row.change
    any = true
  }
  return any ? sum : null
}

export interface SRVelocity {
  perWeek: number | null
  perSession: number | null
  sessions: number
  readCount: number
  /** Matches in the window, read or not — the honest denominator. */
  readOf: number
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
  const { net, readCount, readOf } = srDelta(records, days)
  const sessions = sessionCount(recent)
  if (net === null) {
    return { perWeek: null, perSession: null, sessions, readCount: 0, readOf }
  }
  const weeks = days / DAYS_PER_WEEK
  return {
    perWeek: weeks > 0 ? net / weeks : null,
    perSession: sessions > 0 ? net / sessions : null,
    sessions,
    readCount,
    readOf,
  }
}

export interface SRHeroRow {
  hero: string
  net: number
  /** The most recent SR reading for this hero — where they actually stand. */
  latest: number
  readCount: number
}

/**
 * SR movement split by the hero that earned it, newest reading kept.
 *
 * One number hides the case this exists for: a Lúcio climbing while an Ana
 * slides. Overwatch banks SR per hero, so a single net figure can read flat
 * while both halves moved.
 *
 * The records are sorted by match time HERE rather than trusted to arrive in
 * order: `latest` is the whole point of the row, and "whichever row the loop
 * saw last" is not a time.
 */
export function srPerHero(records: readonly MomentumInput[]): SRHeroRow[] {
  const byHero = new Map<string, SRHeroRow>()
  const inOrder = [...records]
    .map((rec) => ({ rec, t: matchEpoch(rec) }))
    .filter((entry): entry is { rec: MomentumInput; t: number } => entry.t !== null)
    .sort((a, b) => a.t - b.t)
  for (const { rec } of inOrder) {
    for (const row of rec.data?.sr ?? []) {
      foldSRRow(byHero, row)
    }
  }
  return [...byHero.values()]
    .sort((a, b) => b.readCount - a.readCount || Math.abs(b.net) - Math.abs(a.net))
    .slice(0, TOP_HEROES)
}

/** One SR row folded into the per-hero tally. Extracted so srPerHero stays
 *  one loop rather than a loop and a branch tree. */
function foldSRRow(into: Map<string, SRHeroRow>, row: HeroSr): void {
  // A card with no readable movement is a hero the screen listed, not a
  // reading — counting it would grow readCount and pull `net` toward zero.
  if (typeof row.change !== 'number' || !row.hero) return
  const prev = into.get(row.hero)
  into.set(row.hero, {
    hero: row.hero,
    net: (prev?.net ?? 0) + row.change,
    latest: row.sr,
    readCount: (prev?.readCount ?? 0) + 1,
  })
}
