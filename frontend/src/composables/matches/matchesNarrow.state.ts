import { computed, ref } from 'vue'
import type { LeaverHandling } from '@/composables/matches/useMatchesDossier'
import type {
  CreateMatchesNarrowStateOptions,
  MatchesNarrowState,
  PresetRange,
  ReviewedByPick,
  QueuePick,
  PlayModePick,
  SourcePick,
  LeaverPick,
} from '@/composables/matches/matchesNarrow.types'

// Factory for the parent-owned narrow-filter state bundle (one set of refs
// shared by useMatchesNarrow + MatchesView so the detail-panel selection
// paginates the same filtered set). Re-exported from useMatchesNarrow.
export function createMatchesNarrowState(opts: CreateMatchesNarrowStateOptions = {}): MatchesNarrowState {
  return {
    searchText:       ref(''),
    pickedMaps:       ref(new Set<string>()),
    pickedGameModes:   ref(new Set<string>()),
    pickedHeroes:     ref(new Set<string>()),
    pickedRoles:      ref(new Set<string>()),
    pickedResults:    ref(new Set<string>()),
    pickedTags:       ref(new Set<string>()),
    pickedMembers:    ref(new Set<string>()),
    pickedReviewedBy: ref(new Set<ReviewedByPick>()),
    pickedQueues:     ref(new Set<QueuePick>()),
    pickedPlayModes:  ref(new Set<PlayModePick>()),
    pickedSources:    ref(new Set<SourcePick>()),
    pickedLeavers:    ref(new Set<LeaverPick>()),
    pickedModifiers:  ref(new Set<string>()),
    pickedRanks:      ref(new Set<string>()),
    pickedRange:      ref<PresetRange>('all'),
    customFrom:       ref(''),
    customTo:         ref(''),
    leaverHandling:   ref<LeaverHandling>('include'),
    minPlayMinutes:   ref(0),
    minPlayPercent:   ref(0),
    includeUnknown:   ref(false),
    // Tests not exercising the anchor pass nothing; we synthesise an
    // always-empty ComputedRef so the filter's `anchorKey.value`
    // reads still work without lifting the wrapper to optional.
    anchorKey:        opts.anchorKey ?? computed(() => ''),
    sinceAnchorActive: ref(false),
  }
}
