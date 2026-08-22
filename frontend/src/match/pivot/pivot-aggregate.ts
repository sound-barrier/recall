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
import type { PivotField } from '@/match/pivot/pivot-fields'
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
// engine reads (`heatmapCellBand` in @/match/trends/match-heatmap-helpers). A win
// RATE alone cannot be judged — 100% off one match and 100% off forty are the
// same number and a very different claim — so every bucket carries the counts
// the rate was computed from alongside it.
export interface PivotTally {
  total: number
  wins: number
  losses: number
  // How many records landed in the bucket at all, parsed result or not. The
  // judgment engine's `empty` band keys off `total`, which counts only
  // records that produced a W/L/D — so a bucket of records whose OCR never
  // yielded a result reads as `empty` and speaks "no matches" while the
  // Matches column beside it shows a count. Consumers use this to tell
  // "nothing here" from "nothing decided here".
  records: number
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

// `total` is every match with a parsed result, draws included — it answers
// "how much was played here", which is what the volume tint and the
// no-matches-at-all check need. It is deliberately NOT the win-rate
// denominator; see winRateOf.
function tallyOf(records: readonly MatchRecord[]): PivotTally {
  const { w, l, d } = tallyWLD([...records])
  return { total: w + l + d, wins: w, losses: l, records: records.length }
}

// Decisive games only — the house convention, because a draw is not a loss,
// and the denominator heatmapCellBand judges over. Dividing by `total`
// instead put the printed number and the tint on different populations: a
// bucket of 8W/7L/3D printed 44% while the band judged 8/15 = 53% and
// painted it a win, so the cell contradicted its own color and its own
// spoken name. Null rather than 0 when nothing was decided — 0% would read
// as "you lost every game", the sentinel the masthead and heatmap both
// refuse to print.
function winRateOf(records: readonly MatchRecord[]): number | null {
  const { wins, losses } = tallyOf(records)
  const decisive = wins + losses
  return decisive === 0 ? null : (wins / decisive) * 100
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

// What an aggregation is, in one place.
//
// This used to be five switches over AggFn plus two hand-kept lists, and
// only ONE of the switches had no `default` arm. Adding an eighth
// aggregation compiled clean, fell through to the measure fold, returned
// null, and painted an empty column — nothing failed, the user just saw
// nothing (TECHNICAL_DEBT.md section 11). A Record over the union does not
// typecheck until every member has an entry, so the same addition is now a
// compile error until it is finished.
interface AggContext {
  records: readonly MatchRecord[]
  /**
   * The measure field's numeric samples, or null when the spec's field is
   * not a measure or nothing qualified. Lazy on purpose: the field-agnostic
   * aggregations must not need a resolvable field.
   */
  samples: () => number[] | null
}

interface AggSpec {
  /** Short, human label — value-shelf chips and crosstab sub-headers. */
  label: string
  /** Fold a bucket of records into the aggregated number. */
  fold: (ctx: AggContext) => number | null
  /** Render the folded number for display. */
  format: (value: number) => string
  /** The column header this aggregation earns over a given field. */
  valueLabel: (fieldLabel: string, spec: ValueSpec) => string
}

const plainNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : formatToHundredths(value)

const overField = (agg: AggFn) => (fieldLabel: string): string => `${fieldLabel} (${agg})`

const foldSamples = (reduce: (nums: number[]) => number) => (ctx: AggContext): number | null => {
  const nums = ctx.samples()
  return nums === null || nums.length === 0 ? null : reduce(nums)
}

const sumOf = (nums: number[]): number => nums.reduce((a, b) => a + b, 0)

const AGG_SPECS: Record<AggFn, AggSpec> = {
  count: {
    label: 'Count',
    fold: (ctx) => ctx.records.length,
    format: plainNumber,
    valueLabel: (fieldLabel, spec) => (spec.field === 'matches' ? 'Matches' : `${fieldLabel} (count)`),
  },
  winRate: {
    label: 'Win rate',
    fold: (ctx) => winRateOf(ctx.records),
    format: (value) => `${Math.round(value)}%`,
    valueLabel: () => 'Win rate',
  },
  kd: {
    label: 'K/D',
    fold: (ctx) => kdOf(ctx.records),
    format: formatToHundredths,
    valueLabel: () => 'K/D',
  },
  sum: { label: 'Sum', fold: foldSamples(sumOf), format: plainNumber, valueLabel: overField('sum') },
  avg: {
    label: 'Average',
    fold: foldSamples((nums) => sumOf(nums) / nums.length),
    format: formatToHundredths,
    valueLabel: overField('avg'),
  },
  min: { label: 'Min', fold: foldSamples((nums) => Math.min(...nums)), format: plainNumber, valueLabel: overField('min') },
  max: { label: 'Max', fold: foldSamples((nums) => Math.max(...nums)), format: plainNumber, valueLabel: overField('max') },
}

/** Every aggregation the pivot engine knows, derived from the registry. */
export const AGG_FNS = Object.keys(AGG_SPECS) as AggFn[]

/** The aggregations that ignore the measure field, so "Matches" can offer them. */
export const FIELD_AGNOSTIC_AGGS: AggFn[] = ['count', 'winRate', 'kd']

// Aggregate one value spec over a bucket of records.
function aggregate(records: readonly MatchRecord[], spec: ValueSpec, byId: Map<string, PivotField>): number | null {
  return AGG_SPECS[spec.agg].fold({
    records,
    samples: () => {
      const field = byId.get(spec.field)
      return field?.kind === 'measure' ? measureSamples(records, field) : null
    },
  })
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
  return AGG_SPECS[agg].label
}

function valueLabel(spec: ValueSpec, byId: Map<string, PivotField>): string {
  const field = byId.get(spec.field)
  return AGG_SPECS[spec.agg].valueLabel(field?.label ?? spec.field, spec)
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
  return AGG_SPECS[agg].format(value)
}
