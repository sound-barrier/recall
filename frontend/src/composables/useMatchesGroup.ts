import { computed, type Ref } from 'vue'
import type { MatchRecord } from '../api'

// Sort + group-by state for the Matches workspace leaves list.
// Extracted from MatchesView so the bucketing logic has its own
// test surface — bucket boundaries (Monday-anchored weeks, YYYY-MM
// for months, etc.) are the kind of "did you handle DST?" detail
// that's much easier to verify in isolation than through the
// integrated UI.

export type GroupBy   = 'none' | 'day' | 'week' | 'month' | 'year'
export type SortOrder = 'newest' | 'oldest'

export interface GroupedSection {
  // Stable key for keyed v-for. "all" when groupBy === 'none'; the
  // bucket's natural identifier otherwise (date string, YYYY-MM,
  // etc.).
  key: string
  // Human-readable header — null when groupBy === 'none' so the UI
  // can omit the divider row entirely.
  header: string | null
  records: MatchRecord[]
}

function sortKey(r: MatchRecord): string {
  // Compose `date + finished_at` so multi-match days break ties by
  // time-of-day, not by parse arrival order. Falls back to
  // parsed_at when both are missing (undated rows).
  return `${r.data?.date ?? ''}T${r.data?.finished_at ?? ''}` || (r.parsed_at ?? '')
}

function bucketFor(date: string, bucket: GroupBy): { key: string; label: string } {
  if (!date) return { key: 'no-date', label: 'No date' }
  if (bucket === 'none') return { key: date, label: '' }
  if (bucket === 'year') return { key: date.slice(0, 4), label: date.slice(0, 4) }
  if (bucket === 'month') {
    const key = date.slice(0, 7)
    const d = new Date(date + 'T00:00:00')
    const label = isNaN(d.getTime())
      ? key
      : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    return { key, label }
  }
  if (bucket === 'week') {
    const d = new Date(date + 'T00:00:00')
    if (isNaN(d.getTime())) return { key: date, label: date }
    // Monday-anchored week — matches the rest of the app's default
    // (useWeekStart). JS getDay returns 0 = Sunday … 6 = Saturday;
    // (day + 6) % 7 maps Sunday→6 so subtracting that gives Monday.
    const day = d.getDay()
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((day + 6) % 7))
    const key = monday.toISOString().slice(0, 10)
    const label = `Week of ${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    return { key, label }
  }
  // day
  const d = new Date(date + 'T00:00:00')
  if (isNaN(d.getTime())) return { key: date, label: date }
  return {
    key: date,
    label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
  }
}

export function useMatchesGroup(
  records: Readonly<Ref<MatchRecord[]>>,
  groupBy: Readonly<Ref<GroupBy>>,
  sortOrder: Readonly<Ref<SortOrder>>,
) {
  const sortedRecords = computed(() => {
    return [...records.value].sort((a, b) => {
      return sortOrder.value === 'newest'
        ? sortKey(b).localeCompare(sortKey(a))
        : sortKey(a).localeCompare(sortKey(b))
    })
  })

  const groupedSections = computed<GroupedSection[]>(() => {
    if (groupBy.value === 'none') {
      return [{ key: 'all', header: null, records: sortedRecords.value }]
    }
    const sections: GroupedSection[] = []
    let cur: GroupedSection | null = null
    for (const rec of sortedRecords.value) {
      const { key, label } = bucketFor(rec.data?.date ?? '', groupBy.value)
      if (!cur || cur.key !== key) {
        cur = { key, header: label, records: [] }
        sections.push(cur)
      }
      cur.records.push(rec)
    }
    return sections
  })

  return { sortedRecords, groupedSections }
}
