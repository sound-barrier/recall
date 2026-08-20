import type { MatchRecord, UserMatchDataInput } from '@/api-client'

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

function isHeroStatPath(parts: string[]): boolean {
  return parts.length === 5 && parts[1] === 'heroes_played' && parts[3] === 'stats'
}

/**
 * Rebuild the full override set currently applied to the record.
 *
 * This has to be COMPLETE, because the store's upsert is a whole-row
 * replace: a scalar arriving nil is the per-field revert to OCR. Sending a
 * partial set therefore reverts everything it forgot to mention.
 *
 * Which is why a manual match cannot be read off `edited_fields`. It has no
 * OCR row underneath, so there is nothing to revert TO and nothing is
 * marked as edited — the list is empty by design. Every field it carries is
 * the user's, so every field it carries is the override set.
 */
export function overrideSetFromRecord(rec: MatchRecord): UserMatchDataInput {
  const data = (rec.data ?? {}) as Record<string, unknown>
  if (rec.source === 'manual') return manualOverrideSet(rec, data)

  const out: UserMatchDataInput = {}
  for (const path of rec.edited_fields ?? []) {
    reconstructEditedPath(out, rec, path, data)
  }
  return out
}

/** Put back the one field a dotted `edited_fields` entry names. */
function reconstructEditedPath(
  out: UserMatchDataInput, rec: MatchRecord, path: string, data: Record<string, unknown>,
): void {
  const parts = path.split('.')
  if (parts[0] !== 'data') return
  if (parts.length === 2) {
    reconstructTopLevel(out, parts[1] ?? '', data)
  } else if (isHeroStatPath(parts)) {
    reconstructStat(out, rec, parts[2] ?? '', parts[4] ?? '')
  }
}

/**
 * Everything a manual match holds. Only fields actually present travel — an
 * absent one must stay absent rather than becoming an explicit null, which
 * the store would read as a revert.
 */
function manualOverrideSet(rec: MatchRecord, data: Record<string, unknown>): UserMatchDataInput {
  const out: UserMatchDataInput = {}
  copyPresentFields(out, data)
  // Not a SCALAR_FIELDS member — it is never edited directly — but it has to
  // travel. A manual entry's instant comes from the wire offset, which the
  // wall clock cannot reproduce, so an omitted one is a lost moment rather
  // than a re-derivable one.
  if (typeof data.played_at_utc === 'string') out.played_at_utc = data.played_at_utc
  copyHeroStats(out, rec, data)
  return out
}

/** The fields reconstructTopLevel knows how to put back. */
function travelsWholesale(field: string): boolean {
  return isScalarField(field) || field === 'heroes_played' || field === 'sr'
    || field === 'rank_modifiers'
}

function copyPresentFields(out: UserMatchDataInput, data: Record<string, unknown>): void {
  for (const field of Object.keys(data)) {
    if (data[field] === undefined || data[field] === null) continue
    if (travelsWholesale(field)) reconstructTopLevel(out, field, data)
  }
}

function copyHeroStats(
  out: UserMatchDataInput, rec: MatchRecord, data: Record<string, unknown>,
): void {
  for (const hero of (data.heroes_played as MatchRecord['data']['heroes_played'] ?? [])) {
    for (const statKey of Object.keys(hero.stats ?? {})) {
      reconstructStat(out, rec, hero.hero, statKey)
    }
  }
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

/**
 * Override set with the rank tier AND division filled in one write.
 *
 * Both together, never one at a time: the charts require a numeric division as
 * well as a known tier, so a tier-only fill would persist an edit that left the
 * match exactly as invisible as it was.
 */
export function withRankFill(rec: MatchRecord, tier: string, level: number): UserMatchDataInput {
  const set = overrideSetFromRecord(rec)
  ;(set as Record<string, unknown>).rank = tier
  ;(set as Record<string, unknown>).level = level
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
