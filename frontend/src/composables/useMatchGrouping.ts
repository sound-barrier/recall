import { ref, computed, watch } from 'vue'
import type { Ref } from 'vue'
import { groupMatchesByMonthWeekDay } from '../match-helpers'
import type { MatchGroup, GroupableRecord, WeekStart } from '../match-helpers'

/**
 * useMatchGrouping owns two pieces of state:
 *
 *   1. The Month → Week → Day tree derived from the filtered+sorted list.
 *      Recomputed reactively whenever either input changes.
 *   2. A Set of currently-expanded group keys — independent of the tree
 *      itself, so a user's expansion choices survive filter changes (as
 *      long as the relevant keys still exist).
 *
 * Default behaviour: the FIRST time a non-empty tree appears, the
 * newest month + its newest week + its newest day are auto-expanded
 * (the "I just played, show me today" default). After that, expansion
 * is purely user-driven — re-filtering doesn't reset the user's
 * choices, which matters when scrubbing dates / heroes / maps to find
 * a specific group.
 *
 * Expand-all / Collapse-all are exposed for the filter rail. They
 * operate on the CURRENT tree, so a collapse-all + filter change won't
 * re-collapse anything that wasn't visible at the time.
 */
export function useMatchGrouping<R extends GroupableRecord>(
  filteredSorted: Readonly<Ref<R[]>>,
  sortDir: Readonly<Ref<'asc' | 'desc' | string>>,
  // Optional — defaults to 0 (Sunday) inside the helper when omitted.
  // Pass the useWeekStart ref to make the "Week of <date>" anchor
  // honor the user's Settings preference (any day 0-6).
  weekStart?: Readonly<Ref<WeekStart>>,
  // Optional — when true, tallyWLD drops user-annotated leaver matches
  // from the W/L/D readouts on each group level. The matches still
  // appear in the day's record list; only the tally numbers change.
  // Wired from the FilterRail's 'exclude-tally' setting.
  skipAnnotatedInTally?: Readonly<Ref<boolean>>,
) {
  const groups = computed<MatchGroup<R>[]>(() => {
    const dir = sortDir.value === 'asc' ? 'asc' : 'desc'
    return groupMatchesByMonthWeekDay(filteredSorted.value, dir, {
      weekStart: weekStart?.value ?? 0,
      skipAnnotatedInTally: skipAnnotatedInTally?.value === true,
    })
  })

  // Set<groupKey>. Plain Set wrapped in a ref — mutate by creating a
  // new Set so Vue's reactivity catches the change.
  const expanded = ref<Set<string>>(new Set())

  // Has the user explicitly interacted with the expand state since the
  // app loaded? Once true, we never auto-apply defaults again — the
  // user's choices are sticky.
  let userHasToggled = false

  function isGroupExpanded(key: string): boolean {
    return expanded.value.has(key)
  }

  function setExpanded(key: string, on: boolean) {
    const next = new Set(expanded.value)
    if (on) next.add(key)
    else next.delete(key)
    expanded.value = next
  }

  function toggleGroup(key: string) {
    userHasToggled = true
    setExpanded(key, !expanded.value.has(key))
  }

  // Walks the tree and returns every group key. Used by Expand-all
  // (and indirectly by the default-expansion logic).
  function collectKeys(tree: MatchGroup<R>[]): string[] {
    const out: string[] = []
    const visit = (gs: MatchGroup<R>[]) => {
      for (const g of gs) {
        out.push(g.key)
        if (g.children) visit(g.children)
      }
    }
    visit(tree)
    return out
  }

  // Returns the keys along the first path of the tree (newest month →
  // newest week → newest day). Pretty light walk — bounded by tree
  // depth, not size.
  //
  // Exception: if tree[0] is the UNKNOWN DATE bucket (which happens
  // only when there are zero dated months), return [] so we don't
  // auto-expand a triage bucket the user probably doesn't want pried
  // open every load.
  function firstPathKeys(tree: MatchGroup<R>[]): string[] {
    if (tree[0]?.level === 'unknown') return []
    const path: string[] = []
    let cursor: MatchGroup<R> | undefined = tree[0]
    while (cursor) {
      path.push(cursor.key)
      cursor = cursor.children?.[0]
    }
    return path
  }

  function expandAll() {
    userHasToggled = true
    expanded.value = new Set(collectKeys(groups.value))
  }

  function collapseAll() {
    userHasToggled = true
    expanded.value = new Set()
  }

  // Default-expansion: fire on every group recomputation, but only
  // until the user touches the expand state. After that, expansion is
  // their problem — we don't fight them as filters change.
  watch(
    groups,
    (newGroups) => {
      if (userHasToggled) return
      if (newGroups.length === 0) {
        expanded.value = new Set()
        return
      }
      expanded.value = new Set(firstPathKeys(newGroups))
    },
    { immediate: true },
  )

  // Convenience for the rail: are ALL group keys in the current tree
  // present in the expanded set? Used to render an "expand-all" /
  // "collapse-all" toggle whose label flips depending on state.
  const allExpanded = computed(() => {
    const all = collectKeys(groups.value)
    return all.length > 0 && all.every(k => expanded.value.has(k))
  })
  const anyExpanded = computed(() => expanded.value.size > 0)

  return {
    groups,
    expanded,
    isGroupExpanded,
    toggleGroup,
    expandAll,
    collapseAll,
    allExpanded,
    anyExpanded,
  }
}
