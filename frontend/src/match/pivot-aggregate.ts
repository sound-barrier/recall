// The pivot crosstab engine: fold a flat MatchRecord[] into a
// rows × columns grid of aggregated measures. Pure and deterministic so
// the math is exhaustively unit-tested without a Vue mount; the SFCs only
// render the PivotResult this produces.
//
// Multi-value dimensions (hero pool, tags, roles, members) place a single
// record in several buckets, so per-bucket counts intentionally do NOT
// sum to the match total — that's correct pivot behavior for "win rate
// by hero" over a multi-hero match. Margins (row / column / grand totals)
// re-aggregate the underlying records rather than summing cells, because
// averages and win rates don't sum.

import type { MatchRecord } from '@/api'
import type { PivotField } from '@/match/pivot-fields'
import { formatToHundredths, tallyWLD } from '@/match/match-stats-helpers'

export type AggFn = 'count' | 'winRate' | 'sum' | 'avg' | 'min' | 'max' | 'kd'

export interface ValueSpec {
  field: string // measure field id (ignored by count / winRate / kd)
  agg: AggFn
}

interface PivotFilter {
  field: string // dimension field id
  allowed: string[] // keep only records whose bucket value is in this set
}

export interface PivotConfig {
  rows: string[] // dimension field ids
  columns: string[] // dimension field ids
  values: ValueSpec[]
  filters: PivotFilter[]
}

// The decided population behind a bucket, in the shape the shared judgment
// engine reads (`heatmapCellBand` in @/match/match-heatmap-helpers). A win
// RATE alone cannot be judged — 100% off one match and 100% off forty are the
// same number and a very different claim — so every bucket carries the counts
// the rate was computed from alongside it.
export interface PivotTally {
  total: number
  wins: number
  losses: number
}

// The tallies mirror the cells / rowTotals / colTotals / grandTotals grid
// one-for-one, so a renderer that has a value's coordinates already has its
// evidence.
interface PivotTallies {
  cells: PivotTally[][] // [rowIndex][colIndex]
  rows: PivotTally[] // [rowIndex]
  cols: PivotTally[] // [colIndex]
  grand: PivotTally
}

export interface PivotResult {
  rowFields: string[]
  colFields: string[]
  rowFieldLabels: string[]
  colFieldLabels: string[]
  values: ValueSpec[]
  valueLabels: string[]
  rowKeys: string[][] // each tuple has one label per rowField
  colKeys: string[][]
  cells: (number | null)[][][] // [rowIndex][colIndex][valueIndex]
  rowTotals: (number | null)[][] // [rowIndex][valueIndex]
  colTotals: (number | null)[][] // [colIndex][valueIndex]
  grandTotals: (number | null)[] // [valueIndex]
  tallies: PivotTallies
  recordCount: number
}

const TUPLE_SEP = '\0'
const DEFAULT_VALUES: readonly ValueSpec[] = [
  { field: 'matches', agg: 'count' },
  { field: 'matches', agg: 'winRate' },
]

function isDimension(f: PivotField | undefined): f is Extract<PivotField, { kind: 'dimension' }> {
  return f?.kind === 'dimension'
}

// Cartesian expansion of a record across the chosen dimensions. A
// single-value dimension contributes one branch; a multi-value one
// (hero pool) multiplies the branches. De-duplicated so a record never
// double-counts within the same bucket.
function tuplesFor(rec: MatchRecord, dims: Extract<PivotField, { kind: 'dimension' }>[]): string[][] {
  let acc: string[][] = [[]]
  for (const dim of dims) {
    const vals = dim.values(rec)
    const next: string[][] = []
    for (const partial of acc) {
      for (const v of vals) next.push([...partial, v])
    }
    acc = next
  }
  const seen = new Set<string>()
  return acc.filter((t) => {
    const k = t.join(TUPLE_SEP)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function passesFilters(rec: MatchRecord, filters: PivotFilter[], byId: Map<string, PivotField>): boolean {
  for (const f of filters) {
    const dim = byId.get(f.field)
    if (!isDimension(dim)) continue
    // An empty allow-list is "no constraint" — a field freshly dropped on
    // the Filters shelf before the user has picked any values passes
    // every record rather than hiding them all.
    if (f.allowed.length === 0) continue
    const allow = new Set(f.allowed)
    if (!dim.values(rec).some((v) => allow.has(v))) return false
  }
  return true
}

// `total` is the DECIDED population — the same denominator winRateOf divides
// by — so the tint a consumer derives from the tally and the percentage it
// prints always describe the same matches. Records with no parsed result sit
// in the bucket but claim nothing.
function tallyOf(records: readonly MatchRecord[]): PivotTally {
  const { w, l, d } = tallyWLD([...records])
  return { total: w + l + d, wins: w, losses: l }
}

function winRateOf(records: readonly MatchRecord[]): number | null {
  const { total, wins } = tallyOf(records)
  return total === 0 ? null : (wins / total) * 100
}

function kdOf(records: readonly MatchRecord[]): number {
  let elims = 0
  let deaths = 0
  for (const r of records) {
    elims += r.data?.eliminations ?? 0
    deaths += r.data?.deaths ?? 0
  }
  return deaths === 0 ? elims : elims / deaths
}

function measureSamples(
  records: readonly MatchRecord[],
  field: Extract<PivotField, { kind: 'measure' }>,
): number[] {
  const nums: number[] = []
  for (const r of records) {
    const v = field.value(r)
    if (v !== null && Number.isFinite(v)) nums.push(v)
  }
  return nums
}

// sum/avg/min/max over the named measure, skipping null/non-finite
// samples; null when the field isn't a measure or nothing qualified.
function foldMeasure(records: readonly MatchRecord[], spec: ValueSpec, byId: Map<string, PivotField>): number | null {
  const field = byId.get(spec.field)
  if (field?.kind !== 'measure') return null
  const nums = measureSamples(records, field)
  if (nums.length === 0) return null
  const sum = nums.reduce((a, b) => a + b, 0)
  switch (spec.agg) {
    case 'sum': return sum
    case 'avg': return sum / nums.length
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
  }
  return null
}

// Aggregate one value spec over a bucket of records. count / winRate / kd
// are field-agnostic (kd is always elims/deaths); the rest fold the
// named measure.
function aggregate(records: readonly MatchRecord[], spec: ValueSpec, byId: Map<string, PivotField>): number | null {
  switch (spec.agg) {
    case 'count':   return records.length
    case 'winRate': return winRateOf(records)
    case 'kd':      return kdOf(records)
    default:        return foldMeasure(records, spec, byId)
  }
}

function compareTuples(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const c = (a[i] ?? '').localeCompare(b[i] ?? '')
    if (c !== 0) return c
  }
  return 0
}

// Short, human label for an aggregation — used by the value-shelf chips
// and the crosstab sub-headers.
export function aggLabelOf(agg: AggFn): string {
  switch (agg) {
    case 'count':   return 'Count'
    case 'winRate': return 'Win rate'
    case 'sum':     return 'Sum'
    case 'avg':     return 'Average'
    case 'min':     return 'Min'
    case 'max':     return 'Max'
    case 'kd':      return 'K/D'
  }
}

function valueLabel(spec: ValueSpec, byId: Map<string, PivotField>): string {
  const field = byId.get(spec.field)
  const fieldLabel = field?.label ?? spec.field
  switch (spec.agg) {
    case 'count':   return spec.field === 'matches' ? 'Matches' : `${fieldLabel} (count)`
    case 'winRate': return 'Win rate'
    case 'kd':      return 'K/D'
    // sum/avg/min/max label as "<field> (<agg>)" — the agg id doubles
    // as its display suffix.
    default:        return `${fieldLabel} (${spec.agg})`
  }
}

// pivot folds the records into the crosstab described by `config`,
// resolving field ids against `fields`. An empty rows/columns list yields
// a single grand-total cell; missing fields are skipped.
export function pivot(records: readonly MatchRecord[], config: PivotConfig, fields: PivotField[]): PivotResult {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const rowDims = config.rows.map((id) => byId.get(id)).filter(isDimension)
  const colDims = config.columns.map((id) => byId.get(id)).filter(isDimension)
  const values = config.values.length > 0 ? config.values : [...DEFAULT_VALUES]

  const filtered = records.filter((r) => passesFilters(r, config.filters, byId))

  const cellBuckets = new Map<string, MatchRecord[]>()
  const rowBuckets = new Map<string, MatchRecord[]>()
  const colBuckets = new Map<string, MatchRecord[]>()
  const rowTupleByKey = new Map<string, string[]>()
  const colTupleByKey = new Map<string, string[]>()

  const push = (m: Map<string, MatchRecord[]>, k: string, r: MatchRecord) => {
    const bucket = m.get(k)
    if (bucket) bucket.push(r)
    else m.set(k, [r])
  }

  for (const rec of filtered) {
    const rTuples = tuplesFor(rec, rowDims)
    const cTuples = tuplesFor(rec, colDims)
    for (const rt of rTuples) {
      const rk = rt.join(TUPLE_SEP)
      rowTupleByKey.set(rk, rt)
      push(rowBuckets, rk, rec)
    }
    for (const ct of cTuples) {
      const ck = ct.join(TUPLE_SEP)
      colTupleByKey.set(ck, ct)
      push(colBuckets, ck, rec)
    }
    for (const rt of rTuples) {
      for (const ct of cTuples) {
        push(cellBuckets, `${rt.join(TUPLE_SEP)}|${ct.join(TUPLE_SEP)}`, rec)
      }
    }
  }

  const rowKeys = [...rowTupleByKey.values()].sort(compareTuples)
  const colKeys = [...colTupleByKey.values()].sort(compareTuples)

  // Resolve every bucket once, then fold it twice — into the displayed
  // measures and into the tally the judgment engine reads.
  const cellRecords = rowKeys.map((rt) =>
    colKeys.map((ct) => cellBuckets.get(`${rt.join(TUPLE_SEP)}|${ct.join(TUPLE_SEP)}`) ?? []))
  const rowRecords = rowKeys.map((rt) => rowBuckets.get(rt.join(TUPLE_SEP)) ?? [])
  const colRecords = colKeys.map((ct) => colBuckets.get(ct.join(TUPLE_SEP)) ?? [])
  const fold = (bucket: readonly MatchRecord[]) => values.map((v) => aggregate(bucket, v, byId))

  const cells = cellRecords.map((row) => row.map(fold))
  const rowTotals = rowRecords.map(fold)
  const colTotals = colRecords.map(fold)
  const grandTotals = fold(filtered)
  const tallies: PivotTallies = {
    cells: cellRecords.map((row) => row.map(tallyOf)),
    rows: rowRecords.map(tallyOf),
    cols: colRecords.map(tallyOf),
    grand: tallyOf(filtered),
  }

  return {
    rowFields: config.rows,
    colFields: config.columns,
    rowFieldLabels: rowDims.map((d) => d.label),
    colFieldLabels: colDims.map((d) => d.label),
    values,
    valueLabels: values.map((v) => valueLabel(v, byId)),
    rowKeys,
    colKeys,
    cells,
    rowTotals,
    colTotals,
    grandTotals,
    tallies,
    recordCount: filtered.length,
  }
}

// formatPivotCell renders an aggregated value for display, keyed on the
// aggregation so win rates read "62%", ratios/averages two-decimal, and
// counts/sums as plain integers. null → the em-dash placeholder.
export function formatPivotCell(value: number | null, agg: AggFn): string {
  if (value === null || !Number.isFinite(value)) return '—'
  switch (agg) {
    case 'winRate': return `${Math.round(value)}%`
    case 'avg':
    case 'kd':      return formatToHundredths(value)
    default:        return Number.isInteger(value) ? String(value) : formatToHundredths(value)
  }
}
