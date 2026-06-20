import { computed, type Ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import {
  parseJsonRecord,
  serializeJsonRecord,
  usePersistedRef,
} from '@/composables/shared/usePersistedRef'
import { makePivotFields, type PivotField } from '@/match/pivot-fields'
import { pivot, type AggFn, type PivotConfig } from '@/match/pivot-aggregate'

// Stateful wrapper around the pure pivot engine: owns the persisted pivot
// configuration (which fields sit on which shelf, which aggregations the
// value shelf computes) and exposes the mutators the drag-and-drop UI
// calls. The config persists as JSON field-IDs only — never functions —
// so it round-trips through localStorage; a corrupt or stale value fails
// the guard and falls back to a sensible default. The crosstab itself is
// a computed over the live records, so it re-pivots the instant a field
// moves or the narrowed set changes.
//
// Identity: dimensions live on rows/columns/filters keyed by field id (a
// dimension sits on at most one shelf). VALUE specs are keyed by index —
// the same measure can appear twice with different aggregations (matches
// count AND matches win rate is the default), so the value shelf is an
// ordered list of (field, agg) pairs, not a set of fields.

export type HeroRole = (hero: string | null | undefined) => string
export type DimensionZone = 'rows' | 'columns' | 'filters'
export type PivotZone = DimensionZone | 'values'

const STORAGE_KEY = 'recall.matchesPivotConfig'

// Static id/agg sets for validating a persisted config without a live
// catalog — field ids are independent of the injected heroRole.
const CATALOG = makePivotFields(() => '')
const DIMENSION_IDS = new Set(CATALOG.filter((f) => f.kind === 'dimension').map((f) => f.id))
const MEASURE_IDS = new Set(CATALOG.filter((f) => f.kind === 'measure').map((f) => f.id))
const AGGS = new Set<AggFn>(['count', 'winRate', 'sum', 'avg', 'min', 'max', 'kd'])

// The aggregations offered for a value field. The synthetic `matches`
// field counts/rates the rows; real measures sum/average their samples.
export function aggOptionsFor(fieldId: string): AggFn[] {
  return fieldId === 'matches' ? ['count', 'winRate', 'kd'] : ['sum', 'avg', 'min', 'max']
}

function defaultAggFor(fieldId: string): AggFn {
  return fieldId === 'matches' ? 'count' : 'sum'
}

function defaultConfig(): PivotConfig {
  return {
    rows: ['hero'],
    columns: ['result'],
    values: [
      { field: 'matches', agg: 'count' },
      { field: 'matches', agg: 'winRate' },
    ],
    filters: [],
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function isPivotConfig(decoded: unknown): decoded is PivotConfig {
  if (!decoded || typeof decoded !== 'object') return false
  const c = decoded as Record<string, unknown>
  if (!isStringArray(c.rows) || !c.rows.every((id) => DIMENSION_IDS.has(id))) return false
  if (!isStringArray(c.columns) || !c.columns.every((id) => DIMENSION_IDS.has(id))) return false
  if (!Array.isArray(c.values)) return false
  for (const v of c.values) {
    if (!v || typeof v !== 'object') return false
    const spec = v as Record<string, unknown>
    if (typeof spec.field !== 'string' || !MEASURE_IDS.has(spec.field)) return false
    if (typeof spec.agg !== 'string' || !AGGS.has(spec.agg as AggFn)) return false
  }
  if (!Array.isArray(c.filters)) return false
  for (const f of c.filters) {
    if (!f || typeof f !== 'object') return false
    const flt = f as Record<string, unknown>
    if (typeof flt.field !== 'string' || !DIMENSION_IDS.has(flt.field)) return false
    if (!isStringArray(flt.allowed)) return false
  }
  return true
}

function reorder<T>(list: T[], from: number, delta: number): T[] {
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  if (moved !== undefined) next.splice(to, 0, moved)
  return next
}

export function useMatchPivot(records: Ref<MatchRecord[]>, heroRole: HeroRole) {
  const fields: PivotField[] = makePivotFields(heroRole)
  const byId = new Map(fields.map((f) => [f.id, f]))

  const { value: config, set } = usePersistedRef<PivotConfig>({
    key: STORAGE_KEY,
    defaultValue: defaultConfig(),
    parse: parseJsonRecord(isPivotConfig),
    serialize: serializeJsonRecord,
  })

  const result = computed(() => pivot(records.value, config.value, fields))

  function fieldKind(fieldId: string): PivotField['kind'] | undefined {
    return byId.get(fieldId)?.kind
  }

  // Drop a field on a shelf. A measure appends a new value spec (duplicates
  // welcome — sum AND avg of damage is valid). A dimension moves to the
  // target shelf, leaving any other dimension shelf it was on.
  function assignField(fieldId: string, zone: PivotZone): void {
    const kind = fieldKind(fieldId)
    if (kind === undefined) return
    if (zone === 'values') {
      if (kind !== 'measure') return
      set({ ...config.value, values: [...config.value.values, { field: fieldId, agg: defaultAggFor(fieldId) }] })
      return
    }
    if (kind !== 'dimension') return
    const next: PivotConfig = {
      ...config.value,
      rows: config.value.rows.filter((id) => id !== fieldId),
      columns: config.value.columns.filter((id) => id !== fieldId),
      filters: config.value.filters.filter((f) => f.field !== fieldId),
    }
    if (zone === 'rows') next.rows = [...next.rows, fieldId]
    else if (zone === 'columns') next.columns = [...next.columns, fieldId]
    else next.filters = [...next.filters, { field: fieldId, allowed: [] }]
    set(next)
  }

  // Remove a dimension from every shelf it sits on (rows/columns/filters).
  function removeField(fieldId: string): void {
    set({
      ...config.value,
      rows: config.value.rows.filter((id) => id !== fieldId),
      columns: config.value.columns.filter((id) => id !== fieldId),
      filters: config.value.filters.filter((f) => f.field !== fieldId),
    })
  }

  function removeValue(index: number): void {
    set({ ...config.value, values: config.value.values.filter((_, i) => i !== index) })
  }

  // Reorder a dimension within rows/columns (nesting order).
  function moveField(fieldId: string, zone: DimensionZone, delta: number): void {
    if (zone === 'filters') return
    const list = config.value[zone]
    set({ ...config.value, [zone]: reorder(list, list.indexOf(fieldId), delta) })
  }

  function moveValue(index: number, delta: number): void {
    set({ ...config.value, values: reorder(config.value.values, index, delta) })
  }

  function setValueAgg(index: number, agg: AggFn): void {
    set({ ...config.value, values: config.value.values.map((v, i) => (i === index ? { ...v, agg } : v)) })
  }

  function cycleValueAgg(index: number): void {
    const spec = config.value.values[index]
    if (!spec) return
    const opts = aggOptionsFor(spec.field)
    const nextAgg = opts[(opts.indexOf(spec.agg) + 1) % opts.length]
    if (nextAgg) setValueAgg(index, nextAgg)
  }

  function setFilterAllowed(fieldId: string, allowed: string[]): void {
    set({ ...config.value, filters: config.value.filters.map((f) => (f.field === fieldId ? { ...f, allowed } : f)) })
  }

  function resetPivot(): void {
    set(defaultConfig())
  }

  // The field tray: dimensions not yet placed on a shelf, plus every
  // measure (measures stay draggable so a user can add several
  // aggregations of the same one).
  const unusedFields = computed(() => {
    const placed = new Set<string>([
      ...config.value.rows,
      ...config.value.columns,
      ...config.value.filters.map((f) => f.field),
    ])
    return fields.filter((f) => f.kind === 'measure' || !placed.has(f.id))
  })

  return {
    fields,
    byId,
    config,
    result,
    unusedFields,
    fieldKind,
    assignField,
    removeField,
    removeValue,
    moveField,
    moveValue,
    setValueAgg,
    cycleValueAgg,
    setFilterAllowed,
    resetPivot,
  }
}
