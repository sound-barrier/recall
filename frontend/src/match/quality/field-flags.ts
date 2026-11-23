import type { FieldFlag, MatchRecord } from '@/api-client'
import { statPath } from '@/match/match-overrides'

// A field the cross-check flagged stays out of every stat until the user
// settles it: confirming the value as read, or editing it. Only an OPEN flag
// leaves anything out — the server marks a flag confirmed or edited, and
// re-opens one whose confirmation no longer matches what the match reads.
//
// Leaving a field out means making it read as UNREAD, the state every
// consumer already handles for a screenshot that never showed it. So this
// removes values; it never writes a substitute.
//
// Some flags leave nothing out. A flag on WHO was played — the hero list
// (`data.heroes_played`) or one card's hero (`data.heroes_played.<hero>`,
// `data.sr.<hero>`) — doubts the key every other number on the card hangs
// off. Removing the hero would hand its share and its stats to whichever
// hero is left, which distorts more than the doubt does. Those flags still
// count as open review work; the record stays whole.

/** The Unknown tab's flagged-readings section: its DOM id, and what links to it ask to reveal. */
export const FIELD_FLAG_SECTION = 'section-field-flags'

type MatchData = MatchRecord['data']
type HeroPlay = NonNullable<MatchData['heroes_played']>[number]

// Rules out one flagged field: the data without it, or null when the field
// is not one this rule removes or the data does not hold it.
type Exclusion = (data: MatchData, field: string) => MatchData | null

// E/A/D are one stat line. KDA, K/D and the per-10-minute rates all mix the
// three and read a missing member as 0, so leaving out only the flagged one
// would turn 74/9/6 into 0/9/6. The SUMMARY performance card is the same
// three numbers read again, and the card it disagrees with, so it goes too.
const COMBAT_LINE = ['eliminations', 'assists', 'deaths', 'performance'] as const
const COMBAT_FIELDS = new Set(['data.eliminations', 'data.assists', 'data.deaths'])

const SINGLE_SCALARS = new Set([
  'damage', 'healing', 'mitigation', 'result', 'level',
  'rank_progress', 'change_percent', 'rank_percentile',
])

function withoutKeys(data: MatchData, keys: readonly string[]): MatchData | null {
  const entries = Object.entries(data)
  const kept = entries.filter(([key, value]) => !keys.includes(key) || value === undefined)
  return kept.length === entries.length ? null : Object.fromEntries(kept) as MatchData
}

const withoutCombatLine: Exclusion = (data, field) =>
  COMBAT_FIELDS.has(field) ? withoutKeys(data, COMBAT_LINE) : null

const withoutScalar: Exclusion = (data, field) => {
  const key = field.slice('data.'.length)
  return field.startsWith('data.') && SINGLE_SCALARS.has(key) ? withoutKeys(data, [key]) : null
}

// Rewrites the one hero card `change` answers for; null when none does.
function withHeroChanged(data: MatchData, change: (hero: HeroPlay) => HeroPlay | null): MatchData | null {
  const heroes = data.heroes_played ?? []
  for (const [i, hero] of heroes.entries()) {
    const next = change(hero)
    if (next) return { ...data, heroes_played: heroes.map((h, j) => (j === i ? next : h)) }
  }
  return null
}

// Hero keys are matched as whole paths, as the server matches them, since a
// hero key can hold the "." that separates path segments.
const withoutHeroPercent: Exclusion = (data, field) => withHeroChanged(data, (hero) => {
  if (field !== `data.heroes_played.${hero.hero}.percent_played` || hero.percent_played === undefined) return null
  const { percent_played: _left, ...rest } = hero
  return rest
})

const withoutHeroStat: Exclusion = (data, field) => withHeroChanged(data, (hero) => {
  const stats = Object.entries(hero.stats ?? {})
  const kept = stats.filter(([key]) => field !== statPath(hero.hero, key))
  return kept.length === stats.length ? null : { ...hero, stats: Object.fromEntries(kept) }
})

// A rank card's SR is its one measurement; a card without it is no card.
const withoutSRCard: Exclusion = (data, field) => {
  const cards = data.sr ?? []
  const kept = cards.filter((card) => field !== `data.sr.${card.hero}.sr`)
  return kept.length === cards.length ? null : { ...data, sr: kept }
}

const EXCLUSIONS: readonly Exclusion[] = [
  withoutCombatLine, withoutScalar, withoutHeroPercent, withoutHeroStat, withoutSRCard,
]

function excluded(data: MatchData, field: string): MatchData | null {
  for (const exclude of EXCLUSIONS) {
    const next = exclude(data, field)
    if (next) return next
  }
  return null
}

/** The record's flags still waiting on the user. */
export function openFlags(rec: Pick<MatchRecord, 'field_flags'>): FieldFlag[] {
  return (rec.field_flags ?? []).filter((flag) => flag.state === 'open')
}

/** Whether `path` (a dotted field path) carries an open flag. */
export function isFieldFlagged(rec: Pick<MatchRecord, 'field_flags'>, path: string): boolean {
  return openFlags(rec).some((flag) => flag.field === path)
}

/** The open flags that keep a value of this record out of the stats. */
export function leftOutFields(rec: MatchRecord): FieldFlag[] {
  return openFlags(rec).filter((flag) => excluded(rec.data, flag.field) !== null)
}

// The top-level values `next` no longer holds that `data` did.
function droppedKeys(data: MatchData, next: MatchData): string[] {
  return Object.entries(data)
    .filter(([key, value]) => value !== undefined && next[key as keyof MatchData] === undefined)
    .map(([key]) => key)
}

/**
 * Each top-level value an open flag leaves out of the stats, by its path,
 * mapped to the flagged field that leaves it out — its own flag first, so an
 * E/A/D sibling names the flag it waits on. The same rules as
 * withoutSuspectFields, so a surface showing the record AS READ can mark
 * exactly what the stats leave out.
 */
export function leftOutPaths(rec: MatchRecord): Map<string, string> {
  const out = new Map<string, string>()
  for (const flag of openFlags(rec)) {
    const next = excluded(rec.data, flag.field)
    for (const key of next ? droppedKeys(rec.data, next) : []) {
      const path = `data.${key}`
      if (!out.has(path) || path === flag.field) out.set(path, flag.field)
    }
  }
  return out
}

/**
 * The record with every openly flagged field left out. A record nothing is
 * left out of comes back as the same object, and an untouched part of a
 * changed one is shared rather than copied.
 */
export function withoutSuspectFields(rec: MatchRecord): MatchRecord {
  let data = rec.data
  for (const flag of openFlags(rec)) data = excluded(data, flag.field) ?? data
  return data === rec.data ? rec : { ...rec, data }
}

/** withoutSuspectFields over a list — the same list when nothing changed. */
export function recordsWithoutSuspectFields(records: MatchRecord[]): MatchRecord[] {
  const out = records.map(withoutSuspectFields)
  return out.every((rec, i) => rec === records[i]) ? records : out
}
