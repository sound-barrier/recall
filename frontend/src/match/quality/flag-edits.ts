import type { FieldFlag, FieldReading, MatchRecord, UserMatchDataInput } from '@/api-client'
import { statPath, withScalarEdit, withStatEdit, type ScalarField } from '@/match/match-overrides'

// Settling a flagged reading by Edit, or by picking the reading another
// source made, is the ordinary override write (PUT /matches/{key}/data):
// the WHOLE override set, rebuilt from the record as read, with the one
// flagged field changed. The flag's path names where the value goes: a scalar
// is a field, a hero-stat cell is a cell, and each kind has an editor here.
//
// Build from the record AS READ (the store's unfilteredRecord), never the
// stats' copy: an open E/A/D flag strips the whole combat line from that
// copy, and an override set rebuilt from it silently drops those edits.
//
// Who was played (the hero list, a card's hero) has no editor. It is the key
// every other number on the card hangs off; the review offers Confirm alone
// and the match's own editor does the rest. So does the rank percentile,
// which no override can carry.
//
// Nor does a hero's share or a card's SR. Each can only be written as the
// whole list it sits in, and that write does more than the card shows: the
// server rebuilds a hero list without the per-hero stats the parse read, and
// marks the whole collection edited, which settles every sibling flag in it
// unseen — including the who-was-played flags this review refuses to edit.

export type FlagEditKind = 'number' | 'result'

type Apply = (value: number | string) => UserMatchDataInput

interface Editor { kind: FlagEditKind; apply: Apply }

/** Resolves the editor for one path on one record, or null when it is not this kind's. */
type EditorRule = (rec: MatchRecord, field: string) => Editor | null

const NUMERIC_SCALARS: readonly ScalarField[] = [
  'eliminations', 'assists', 'deaths', 'damage', 'healing', 'mitigation',
  'level', 'rank_progress', 'change_percent',
]
/** The words a result can be, in the order the review offers them. */
export const RESULTS: readonly NonNullable<UserMatchDataInput['result']>[] = ['victory', 'defeat', 'draw']

const numericScalar: EditorRule = (rec, field) => {
  const key = NUMERIC_SCALARS.find((name) => field === `data.${name}`)
  return key ? { kind: 'number', apply: (v) => withScalarEdit(rec, key, v) } : null
}

const result: EditorRule = (rec, field) =>
  field === 'data.result' ? { kind: 'result', apply: (v) => withScalarEdit(rec, 'result', v) } : null

const heroStat: EditorRule = (rec, field) => {
  for (const hero of rec.data.heroes_played ?? []) {
    const key = Object.keys(hero.stats ?? {}).find((k) => field === statPath(hero.hero, k))
    if (key) return { kind: 'number', apply: (v) => withStatEdit(rec, hero.hero, key, Number(v)) }
  }
  return null
}

const EDITOR_RULES: readonly EditorRule[] = [numericScalar, result, heroStat]

function editorFor(rec: MatchRecord, field: string): Editor | null {
  for (const rule of EDITOR_RULES) {
    const editor = rule(rec, field)
    if (editor) return editor
  }
  return null
}

function parsed(kind: FlagEditKind, raw: string): number | string | null {
  const value = raw.trim()
  if (kind === 'result') return (RESULTS as readonly string[]).includes(value) ? value : null
  const n = Number(value)
  return value !== '' && Number.isInteger(n) ? n : null
}

/** What the review asks for when the field is edited; null when it cannot edit it. */
export function flagEditKind(rec: MatchRecord, field: string): FlagEditKind | null {
  return editorFor(rec, field)?.kind ?? null
}

/** The override set with `field` set to `raw`; null when the field has no editor or `raw` is no value for it. */
export function withFlaggedValue(rec: MatchRecord, field: string, raw: string): UserMatchDataInput | null {
  const editor = editorFor(rec, field)
  if (!editor) return null
  const value = parsed(editor.kind, raw)
  return value === null ? null : editor.apply(value)
}

/** The readings the match could switch to: each other value once, when it is one the field can hold. */
export function otherReadings(rec: MatchRecord, flag: FieldFlag): FieldReading[] {
  const kind = flagEditKind(rec, flag.field)
  if (!kind) return []
  const seen = new Set([flag.value])
  return flag.readings.filter((reading) => {
    if (seen.has(reading.value) || parsed(kind, reading.value) === null) return false
    seen.add(reading.value)
    return true
  })
}
