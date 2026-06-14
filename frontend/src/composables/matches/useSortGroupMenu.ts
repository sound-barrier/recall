import { ref, computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { GroupBy, SortOrder } from '@/composables/matches/useMatchesGroup'
import type { Density } from '@/composables/matches/useDensity'

// The Matches list's combined Sort + Group control: the persisted sort
// order + grouping, the trigger-anchored popover open/close, and the
// trigger's summary label. Extracted from MatchesView so the workspace
// shell sheds this control's state. `density` feeds the label — Data
// density is a flat spreadsheet, so the label drops the grouping suffix.
const SORT_LABELS: Record<SortOrder, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
}
const GROUP_LABELS: Record<GroupBy, string> = {
  none:  'no group',
  day:   'by day',
  week:  'by week',
  month: 'by month',
  year:  'by year',
}

export function useSortGroupMenu(density: MaybeRefOrGetter<Density>) {
  const sortOrder = ref<SortOrder>('newest')
  const groupBy = ref<GroupBy>('day')
  const sortGroupOpen = ref(false)
  const sortGroupAnchor = ref<DOMRect | null>(null)

  function onSortGroupTriggerClick(e: MouseEvent) {
    const t = e.currentTarget as HTMLElement | null
    if (!t) return
    sortGroupAnchor.value = t.getBoundingClientRect()
    sortGroupOpen.value = !sortGroupOpen.value
  }

  function closeSortGroup() {
    sortGroupOpen.value = false
    sortGroupAnchor.value = null
  }

  // Data density sorts by column header (the trigger opens the Custom
  // Sort dialog), so the leaf newest/oldest + grouping summary doesn't
  // apply — the label is just "Sort".
  const sortGroupLabel = computed(() =>
    toValue(density) === 'data'
      ? 'Sort'
      : `${SORT_LABELS[sortOrder.value]} · ${GROUP_LABELS[groupBy.value]}`,
  )

  return { sortOrder, groupBy, sortGroupOpen, sortGroupAnchor, onSortGroupTriggerClick, closeSortGroup, sortGroupLabel }
}
