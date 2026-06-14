import { computed, isRef, type Ref } from 'vue'
import type { MatchRecord } from '@/api'

type MaybeRef<T> = T | Ref<T>
function unref<T>(v: MaybeRef<T>): T {
  return isRef(v) ? v.value : v
}

// useMatchHeatmap — buckets a match list into a 7 × N calendar grid
// (one cell per day, organised in week columns). The component on
// top of this composable renders the SVG; the composable owns the
// maths.
//
// Window: fixed trailing `windowWeeks` (default 26 ≈ last 6 months).
// User-controllable via the 3M / 6M / 12M picker on the component
// header. The window does NOT shrink when
// the user sets a date filter from the brush — the heatmap is a
// stable navigation surface, so collapsing it to a single column on
// click would defeat the point. Date-filtering is a side effect of
// clicking a cell, not an input to the grid layout.
//
// Win-rate math: draws are excluded from the denominator so a draw-
// heavy day doesn't drag W% toward 50% artificially. `total` still
// counts draws so saturation (caller-side) reflects activity volume.

interface HeatmapCell {
  date: string          // 'YYYY-MM-DD'
  dayOfWeek: number     // 0..6 — row position, respects weekStartsOn
  weekIndex: number     // 0..N-1 — column position
  wins: number
  losses: number
  draws: number
  total: number         // wins + losses + draws
  winRate: number       // 0..1; 0 when no decided matches (drawn or empty)
  empty: boolean        // total === 0
}

interface MonthLabel {
  weekIndex: number     // column where the month label anchors
  label: string         // 'Jan' / 'Feb' / …
}

export interface HeatmapModel {
  cells: HeatmapCell[]
  weeks: number
  start: string         // 'YYYY-MM-DD' — first date shown
  end: string           // 'YYYY-MM-DD' — last date shown
  monthLabels: MonthLabel[]
  maxTotal: number      // peak matches-per-day across the window — used
                        // by the caller for saturation normalisation
}

export interface UseMatchHeatmapOptions {
  // 0 = Sunday (GitHub default), 1 = Monday (ISO 8601 / European).
  // Drives both the row layout and the week-boundary snap of `start`.
  // Accept a Ref so the caller can flip the picker reactively.
  weekStartsOn?: MaybeRef<0 | 1>
  // Trailing-window size in weeks. Defaults to 26 (≈ last 6 months);
  // common picks are 13 / 26 / 52 (3M / 6M / 12M). Accept a Ref so
  // the user-facing picker rebuilds the grid live.
  windowWeeks?: MaybeRef<number>
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function useMatchHeatmap(
  records: Ref<MatchRecord[]>,
  opts: UseMatchHeatmapOptions = {},
): Ref<HeatmapModel> {
  return computed(() => {
    const weekStartsOn = unref(opts.weekStartsOn ?? 0)
    const windowWeeks = unref(opts.windowWeeks ?? 26)

    const endDate = todayLocal()
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - (windowWeeks * 7 - 1))

    // Snap startDate backward to the most recent weekStartsOn day so
    // every column is a full week.
    while (startDate.getDay() !== weekStartsOn) {
      startDate.setDate(startDate.getDate() - 1)
    }

    // Bucket records by date string.
    const buckets = new Map<string, { w: number; l: number; d: number }>()
    const startIso = toIsoDate(startDate)
    const endIso = toIsoDate(endDate)
    for (const r of records.value) {
      const date = r.data?.date
      if (!date) continue
      if (date < startIso || date > endIso) continue
      let b = buckets.get(date)
      if (!b) { b = { w: 0, l: 0, d: 0 }; buckets.set(date, b) }
      const result = r.data?.result
      if (result === 'victory') b.w++
      else if (result === 'defeat') b.l++
      else if (result === 'draw') b.d++
    }

    // Walk the window one day at a time, emit a cell each.
    const cells: HeatmapCell[] = []
    let maxTotal = 0
    const cursor = new Date(startDate)
    let weekIndex = 0
    while (cursor <= endDate) {
      const iso = toIsoDate(cursor)
      const dow = cursor.getDay()
      const dayOfWeek = (dow - weekStartsOn + 7) % 7
      const b = buckets.get(iso) ?? { w: 0, l: 0, d: 0 }
      const total = b.w + b.l + b.d
      const decided = b.w + b.l
      const winRate = decided > 0 ? b.w / decided : 0
      if (total > maxTotal) maxTotal = total
      cells.push({
        date: iso, dayOfWeek, weekIndex,
        wins: b.w, losses: b.l, draws: b.d,
        total, winRate, empty: total === 0,
      })
      // Advance one day; bump weekIndex when we wrap a row.
      cursor.setDate(cursor.getDate() + 1)
      if (dayOfWeek === 6) weekIndex++
    }

    // Month column labels — anchor at the first week of each month
    // (looking at the cell in the top row, i.e. dayOfWeek === 0).
    const monthLabels: MonthLabel[] = []
    let lastMonth = -1
    for (const c of cells) {
      if (c.dayOfWeek !== 0) continue
      const m = parseLocalDate(c.date).getMonth()
      if (m !== lastMonth) {
        monthLabels.push({ weekIndex: c.weekIndex, label: MONTHS[m]! })
        lastMonth = m
      }
    }

    return {
      cells,
      weeks: weekIndex + (cells.length % 7 === 0 ? 0 : 1),
      start: toIsoDate(startDate),
      end: toIsoDate(endDate),
      monthLabels,
      maxTotal,
    }
  })
}

// parseLocalDate avoids `new Date('YYYY-MM-DD')`'s UTC-midnight bug,
// which on west-of-UTC timezones surfaces the cell one day earlier
// in the grid than the user typed.
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dd}`
}

function todayLocal(): Date {
  const t = new Date()
  return new Date(t.getFullYear(), t.getMonth(), t.getDate())
}

