// The pivot field catalog: every MatchRecord attribute a user can drag
// onto a pivot shelf, split into DIMENSIONS (what you group BY — rows /
// columns / filters) and MEASURES (what you aggregate — values). Pure
// and factory-built so the hero→role lookup (useOWData().heroRole) is
// dependency-injected the same way rolesForHeader takes it, keeping the
// catalog unit-testable without a Vue mount.
//
// Dimensions return the bucket label(s) a record belongs to — multiple
// for multi-value attributes (a Ana+Kiriko match feeds BOTH hero rows),
// which is why pivot counts over hero/tag/role won't sum to the match
// total. Measures return a single numeric value (or null = not counted).

import type { MatchRecord } from '@/api'
import { rolesForHeader } from '@/match/match-helpers'
import { formatPlayModeLabel, formatQueueTypeLabel } from '@/match/match-label-helpers'
import { WEEKDAYS_FULL } from '@/match/match-time-helpers'

type HeroRole = (hero: string | null | undefined) => string

export interface DimensionField {
  id: string
  label: string
  kind: 'dimension'
  values: (rec: MatchRecord) => string[]
}

export interface MeasureField {
  id: string
  label: string
  kind: 'measure'
  value: (rec: MatchRecord) => number | null
}

export type PivotField = DimensionField | MeasureField

// The single bucket label for a record whose dimension value is empty /
// missing, so a pivot still accounts for every match rather than
// silently dropping the blanks.
export const NONE_BUCKET = '(none)'

function single(v: string | null | undefined): string[] {
  return [v && v !== '' ? v : NONE_BUCKET]
}

function multi(values: readonly string[]): string[] {
  const cleaned = values.filter((v) => v && v !== '')
  return cleaned.length > 0 ? [...cleaned] : [NONE_BUCKET]
}

// The de-duplicated hero pool of a match: every distinct hero from
// heroes_played plus the primary, preserving most-played-first order.
function heroPool(rec: MatchRecord): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const h of rec.data?.heroes_played ?? []) {
    if (h.hero && !seen.has(h.hero)) { seen.add(h.hero); out.push(h.hero) }
  }
  const primary = rec.data?.hero
  if (primary && !seen.has(primary)) out.push(primary)
  return out
}

function dayOfWeek(rec: MatchRecord): string {
  const d = rec.data?.date
  if (!d) return NONE_BUCKET
  const dt = new Date(`${d}T00:00:00`)
  return Number.isNaN(dt.getTime()) ? NONE_BUCKET : WEEKDAYS_FULL[dt.getDay()] ?? NONE_BUCKET
}

// Four coarse time-of-day bands off the match's finish time, so a user
// can pivot win rate by "when I play" without a continuous axis.
function timeOfDay(rec: MatchRecord): string {
  const at = rec.data?.finished_at
  if (!at) return NONE_BUCKET
  const hour = Number(at.split(':')[0])
  if (!Number.isFinite(hour)) return NONE_BUCKET
  if (hour < 6) return 'Night (0–6)'
  if (hour < 12) return 'Morning (6–12)'
  if (hour < 18) return 'Afternoon (12–18)'
  return 'Evening (18–24)'
}

// makePivotFields builds the catalog with `heroRole` injected for the
// role dimension. Order is the order chips appear in the field tray:
// dimensions first (most-reached-for first), then measures.
export function makePivotFields(heroRole: HeroRole): PivotField[] {
  const dimensions: DimensionField[] = [
    { id: 'hero',       label: 'Hero',        kind: 'dimension', values: (r) => multi(heroPool(r)) },
    { id: 'role',       label: 'Role',        kind: 'dimension', values: (r) => multi(rolesForHeader(r, heroRole)) },
    { id: 'map',        label: 'Map',         kind: 'dimension', values: (r) => single(r.data?.map) },
    { id: 'gameMode',   label: 'Game mode',   kind: 'dimension', values: (r) => single(r.data?.game_mode) },
    { id: 'result',     label: 'Result',      kind: 'dimension', values: (r) => single(r.data?.result) },
    { id: 'playMode',   label: 'Mode',        kind: 'dimension', values: (r) => [formatPlayModeLabel(r)] },
    { id: 'queue',      label: 'Queue',       kind: 'dimension', values: (r) => [formatQueueTypeLabel(r)] },
    { id: 'rank',       label: 'Rank',        kind: 'dimension', values: (r) => single(r.data?.rank) },
    { id: 'tags',       label: 'Tags',        kind: 'dimension', values: (r) => multi(r.annotation?.tags ?? []) },
    { id: 'members',    label: 'Team members', kind: 'dimension', values: (r) => multi(r.annotation?.members ?? []) },
    { id: 'reviewedBy', label: 'Reviewed by', kind: 'dimension', values: (r) => single(r.reviewed_by || 'unreviewed') },
    { id: 'source',     label: 'Source',      kind: 'dimension', values: (r) => single(r.source || 'ocr') },
    { id: 'dayOfWeek',  label: 'Day of week', kind: 'dimension', values: (r) => [dayOfWeek(r)] },
    { id: 'timeOfDay',  label: 'Time of day', kind: 'dimension', values: (r) => [timeOfDay(r)] },
    { id: 'month',      label: 'Month',       kind: 'dimension', values: (r) => single(r.data?.date?.slice(0, 7)) },
  ]
  const measures: MeasureField[] = [
    { id: 'matches',      label: 'Matches',      kind: 'measure', value: () => 1 },
    { id: 'eliminations', label: 'Eliminations', kind: 'measure', value: (r) => r.data?.eliminations ?? null },
    { id: 'assists',      label: 'Assists',      kind: 'measure', value: (r) => r.data?.assists ?? null },
    { id: 'deaths',       label: 'Deaths',       kind: 'measure', value: (r) => r.data?.deaths ?? null },
    { id: 'damage',       label: 'Damage',       kind: 'measure', value: (r) => r.data?.damage ?? null },
    { id: 'healing',      label: 'Healing',      kind: 'measure', value: (r) => r.data?.healing ?? null },
    { id: 'mitigation',   label: 'Mitigation',   kind: 'measure', value: (r) => r.data?.mitigation ?? null },
  ]
  return [...dimensions, ...measures]
}
