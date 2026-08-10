import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import type { FormCondition, TimeWindow } from '@/match/match-form-slices'

// Drill-through from a Form comparison cell into the Matches tab: reset the
// shared narrow, write the cell's window as a custom date range, apply the
// row's dimension + the column's condition as picks, then switch views. Uses
// the same direct-write pattern as the Trends brush (TrendsSection.vue) — the
// narrow bundle is one shared instance, so Matches reflects it immediately.

// Row keys whose dimension can be expressed as a narrow pick. Everything else
// (record, winrate, streaks, …) drills to the bare window.
const ROW_PICKS: Record<string, (narrow: NarrowBundle) => void> = {
  roleTank: (n) => n.pickRole('tank'),
  roleDps: (n) => n.pickRole('dps'),
  roleSupport: (n) => n.pickRole('support'),
  compGames: (n) => n.pickPlayMode('competitive'),
  qpGames: (n) => n.pickPlayMode('quickplay'),
  roleQueue: (n) => n.pickQueue('role'),
  openQueue: (n) => n.pickQueue('open'),
}

type NarrowBundle = ReturnType<typeof useMatchesStore>['matchesNarrow']

const ROLE_PICK_KEYS: Record<string, string> = { tank: 'roleTank', dps: 'roleDps', support: 'roleSupport' }

function rolePickKey(role: string): string {
  return ROLE_PICK_KEYS[role] ?? ''
}

export function useFormDrill() {
  const matchesStore = useMatchesStore()
  const appStore = useAppStore()

  function drill(rowKey: string, window: TimeWindow, condition: FormCondition): void {
    const narrow = matchesStore.matchesNarrow
    // resetNarrow() forces leaverHandling back to 'include', but the Form's
    // cells were computed under the CURRENT setting — restore it so a drilled
    // list doesn't re-admit leaver matches the cell excluded.
    const keepLeaverHandling = narrow.leaverHandling.value
    narrow.resetNarrow()
    narrow.leaverHandling.value = keepLeaverHandling
    // Known residual: the narrow's date predicate deliberately PASSES records
    // with no derivable time, while Form windows exclude them. Most such rows
    // are also unknown-map (hidden by the narrow's default too); a dated-less
    // record WITH a map would appear in the drilled list despite not being
    // counted — the narrow has no "dated only" clause to express it.
    narrow.customFrom.value = window.from
    narrow.customTo.value = window.to
    narrow.customFromTime.value = ''
    narrow.customToTime.value = ''
    narrow.pickedRange.value = 'custom'

    if (rowKey.startsWith('mode:')) {
      narrow.pickGameMode(rowKey.slice('mode:'.length))
    } else {
      ROW_PICKS[rowKey]?.(narrow)
    }

    // The column's condition, when the narrow can express it (pick* toggle-sets
    // on the freshly-reset state). Solo/weekday/weekend have no equivalent —
    // those columns aren't offered as drillable in the first place. A role
    // condition matching the row's own role pick is skipped: picking twice
    // would toggle it back off.
    if (condition.kind === 'member') narrow.pickMember(condition.name)
    else if (condition.kind === 'role' && rowKey !== rolePickKey(condition.role)) narrow.pickRole(condition.role)
    else if (condition.kind === 'hero') narrow.pickHero(condition.hero)

    void appStore.goToView('matches')
  }

  return { drill }
}
