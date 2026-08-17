import { computed, ref, type Ref } from 'vue'
import type { LeaverHandling } from '@/composables/matches/dossier/useMatchesDossier'
import type {
  CreateMatchesNarrowStateOptions,
  MatchesNarrowState,
  PresetRange,
  ReviewedByPick,
  QueuePick,
  PlayModePick,
  SourcePick,
  LeaverPick,
  ThrowerPick,
  PoolFilter,
} from '@/composables/matches/narrow/matchesNarrow.types'

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
    pickedThrowers:   ref(new Set<ThrowerPick>()),
    pickedModifiers:  ref(new Set<string>()),
    pickedRanks:      ref(new Set<string>()),
    pickedRange:      ref<PresetRange>('all'),
    customFrom:       ref(''),
    customTo:         ref(''),
    customFromTime:   ref(''),
    customToTime:     ref(''),
    pickedSeason:     ref(''),
    leaverHandling:   ref<LeaverHandling>('include'),
    minPlayMinutes:   ref(0),
    minPlayPercent:   ref(0),
    includeUnknown:   ref(false),
    // Tests not exercising the anchor pass nothing; we synthesize an
    // always-empty ComputedRef so the filter's `anchorKey.value`
    // reads still work without lifting the wrapper to optional.
    anchorKey:        opts.anchorKey ?? computed(() => ''),
    sinceAnchorActive: ref(false),
    poolFilter:       ref<PoolFilter | null>(null),
  }
}

// ── Snapshot / restore ────────────────────────────────────────────────
//
// A coaching session puts the coach's own narrow aside for the length of
// the loan (design rule 12) and End puts it back. The pair lives here
// because this module owns the state's shape — a field list restated
// anywhere else is one rename away from silently dropping a dimension.

/** Every mutable narrow field's value, taken at one instant. */
export type MatchesNarrowSnapshot = ReadonlyMap<string, unknown>

// `anchorKey` is a readonly ComputedRef owned by useMatchAnchor and
// persisted per profile — writing it back would throw a Vue warning, and
// the snapshot has no business restoring somebody else's storage.
const ANCHOR_FIELD = 'anchorKey'

// The state is a bundle of same-shaped refs, so it is walked reflectively
// rather than field by field: a new dimension is then covered the day it is
// added to the factory above.
function mutableFields(state: MatchesNarrowState): [string, Ref<unknown>][] {
  const fields = state as unknown as Record<string, Ref<unknown>>
  return Object.keys(fields)
    .filter((field) => field !== ANCHOR_FIELD)
    .map((field) => [field, fields[field] as Ref<unknown>])
}

// The picked-* dimensions are Sets. The narrow's own setters replace rather
// than mutate them, but a snapshot that shared the instance would be one
// stray `.add()` away from lying.
function cloneFieldValue(value: unknown): unknown {
  return value instanceof Set ? new Set(value) : value
}

/** Capture the coach's narrow so End can hand it back untouched. */
export function snapshotMatchesNarrowState(state: MatchesNarrowState): MatchesNarrowSnapshot {
  return new Map(mutableFields(state).map(([field, holder]) => [field, cloneFieldValue(holder.value)]))
}

/** Put a snapshot back. Fields the snapshot never carried are left alone. */
export function restoreMatchesNarrowState(
  state: MatchesNarrowState,
  snapshot: MatchesNarrowSnapshot,
): void {
  for (const [field, holder] of mutableFields(state)) {
    if (snapshot.has(field)) holder.value = cloneFieldValue(snapshot.get(field))
  }
}
