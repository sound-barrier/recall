import type { MatchRecord, UserMatchDataInput } from '@/api'

// Reconstructs and mutates a match's user-override set for the inline editor.
//
// UpdateMatchData replaces the WHOLE override set, so every edit must resend the
// full current set — editing one combat stat must not drop an existing stat-grid
// or hero-list override. MatchRecord doesn't carry the raw override row, only
// `data` (overrides already applied) + `edited_fields` (the overridden paths), so
// we rebuild the set from those two: each edited path's CURRENT data value IS the
// override.

const SCALAR_FIELDS = [
  'map', 'hero', 'eliminations', 'assists', 'deaths', 'damage', 'healing',
  'mitigation', 'result', 'final_score', 'date', 'finished_at', 'game_length',
  'rank', 'level', 'rank_progress', 'change_percent',
] as const

export type ScalarField = (typeof SCALAR_FIELDS)[number]

function isScalarField(s: string): s is ScalarField {
  return (SCALAR_FIELDS as readonly string[]).includes(s)
}

/** Dotted path for a scalar override field, e.g. "data.damage". */
export function scalarPath(field: ScalarField): string {
  return `data.${field}`
}

/** Dotted path for one hero-stat cell, e.g. "data.heroes_played.junkrat.stats.rip_tire_kill". */
export function statPath(hero: string, statKey: string): string {
  return `data.heroes_played.${hero}.stats.${statKey}`
}

export function isFieldEdited(rec: MatchRecord, path: string): boolean {
  return (rec.edited_fields ?? []).includes(path)
}

/** Rebuild the full override set currently applied to the record. */
export function overrideSetFromRecord(rec: MatchRecord): UserMatchDataInput {
  const out: UserMatchDataInput = {}
  const data = (rec.data ?? {}) as Record<string, unknown>
  for (const path of rec.edited_fields ?? []) {
    const parts = path.split('.')
    if (parts[0] !== 'data') continue
    if (parts.length === 2) {
      reconstructTopLevel(out, parts[1] ?? '', data)
    } else if (parts.length === 5 && parts[1] === 'heroes_played' && parts[3] === 'stats') {
      reconstructStat(out, rec, parts[2] ?? '', parts[4] ?? '')
    }
  }
  return out
}

function reconstructTopLevel(out: UserMatchDataInput, field: string, data: Record<string, unknown>): void {
  if (isScalarField(field)) {
    ;(out as Record<string, unknown>)[field] = data[field]
    return
  }
  if (field === 'heroes_played') {
    out.heroes = (data.heroes_played as MatchRecord['data']['heroes_played'] ?? []).map((h, i) => ({
      hero: h.hero,
      percent_played: h.percent_played,
      play_time: h.play_time,
      position: i,
    }))
  } else if (field === 'sr') {
    out.sr = (data.sr as MatchRecord['data']['sr'] ?? []).map((s) => ({ hero: s.hero, sr: s.sr, change: s.change }))
  } else if (field === 'modifiers') {
    out.modifiers = [...((data.modifiers as string[]) ?? [])]
  }
}

function reconstructStat(out: UserMatchDataInput, rec: MatchRecord, hero: string, statKey: string): void {
  const stats = (rec.data?.heroes_played ?? []).find((h) => h.hero === hero)?.stats
  if (stats && statKey in stats) {
    ;(out.hero_stats ??= []).push({ hero, stat_key: statKey, value: stats[statKey] as number })
  }
}

/** Override set with one scalar field set to `value` (added or replaced). */
export function withScalarEdit(rec: MatchRecord, field: ScalarField, value: number | string): UserMatchDataInput {
  const set = overrideSetFromRecord(rec)
  ;(set as Record<string, unknown>)[field] = value
  return set
}

/** Override set with one hero-stat cell set to `value`. */
export function withStatEdit(rec: MatchRecord, hero: string, statKey: string, value: number): UserMatchDataInput {
  const set = overrideSetFromRecord(rec)
  set.hero_stats = (set.hero_stats ?? []).filter((s) => !(s.hero === hero && s.stat_key === statKey))
  set.hero_stats.push({ hero, stat_key: statKey, value })
  return set
}

/**
 * True when an override set carries nothing — every scalar absent and every
 * child array empty. Reverting the last edited field lands here; the caller
 * resets the match (DELETE) rather than persisting an empty row that would
 * otherwise read as "edited" with no edits.
 */
export function isEmptyOverrideSet(set: UserMatchDataInput): boolean {
  return Object.values(set).every((v) => v == null || (Array.isArray(v) && v.length === 0))
}

/** Override set with the field at `path` removed (per-field revert to OCR). */
export function withoutField(rec: MatchRecord, path: string): UserMatchDataInput {
  const set = overrideSetFromRecord(rec)
  const parts = path.split('.')
  if (parts.length === 2) {
    delete (set as Record<string, unknown>)[parts[1] ?? '']
  } else if (parts.length === 5 && parts[1] === 'heroes_played' && parts[3] === 'stats') {
    set.hero_stats = (set.hero_stats ?? []).filter((s) => !(s.hero === parts[2] && s.stat_key === parts[4]))
  }
  return set
}
