import type { ComputedRef, Ref } from 'vue'
import type { LeaverHandling } from '@/composables/matches/useMatchesDossier'

// Filter-dimension types for the Matches narrow panel. Extracted from
// useMatchesNarrow so the predicates / presets / state factory share one type
// home instead of importing them out of the big composable; useMatchesNarrow
// re-exports them so existing `from './useMatchesNarrow'` imports stay stable.

export type PresetRange = 'all' | '7d' | '30d' | '90d' | 'custom'

// Three "reviewed-by" buckets the narrow panel exposes as a
// multi-select. Empty set ≡ no filter, every record passes.
//   - 'self'        → `reviewed_by === 'self'`
//   - 'coach'       → `reviewed_by === 'coach'`
//   - 'unreviewed'  → no review row exists (reviewed_by absent)
export type ReviewedByPick = 'self' | 'coach' | 'unreviewed'

// QueuePick mirrors the queue_type enum from MatchRecord: 'role'
// (5v5 role queue) or 'open' (6v6 open queue). Picking neither =
// "any" (no clause). There's no "unset" pick — matches whose
// queue_type is missing simply drop out when EITHER pick is active.
export type QueuePick = 'role' | 'open' | 'unknown'

// PlayModePick mirrors the play_mode enum from MatchRecord:
// 'quickplay' (casual) or 'competitive' (ranked). Same semantics as
// QueuePick — multi-select OR, no "unset" pick, matches with empty
// play_mode drop out when EITHER pick is active.
export type PlayModePick = 'quickplay' | 'competitive' | 'unknown'

// SourcePick mirrors the `source` provenance enum on MatchRecord. The
// narrow panel exposes only the two "I touched this" buckets as chips
// — 'ocr_edited' (corrected after parsing) and 'manual' (hand-entered,
// no screenshots). 'ocr' is the fallback bucket for pure parsed
// matches; it's reachable in matchesSource (so picking either chip
// drops pure-OCR rows) but has no chip of its own.
export type SourcePick = 'ocr' | 'ocr_edited' | 'manual'

// LeaverPick mirrors the `annotation.leaver` enum — who left the match.
// The narrow exposes a side multi-select: 'self' (the user left, data
// incomplete), 'team' (a teammate left), 'enemy' (an enemy left). This is
// distinct from `leaverHandling` (which only governs the W/L TALLY) — the
// side filter scopes the SET to matches that carried a leaver. Empty ≡ no
// filter; matches with no leaver tag drop out when any side is picked.
export type LeaverPick = 'self' | 'team' | 'enemy'

// Parent-owned state bundle. App.vue creates it once via
// `createMatchesNarrowState()` and passes the same object to both
// `useMatchesNarrow` (which derives narrowedRecords) and to
// MatchesView (via the `narrow` prop). Sharing the refs is what
// lets `selection` (in App.vue) track the same filtered set the
// view shows — fixing the prev/next + auto-close-on-hide contract
// that broke when each consumer owned its own copy.
export interface MatchesNarrowState {
  searchText:        Ref<string>
  pickedMaps:        Ref<Set<string>>
  pickedGameModes:    Ref<Set<string>>
  pickedHeroes:      Ref<Set<string>>
  pickedRoles:       Ref<Set<string>>
  pickedResults:     Ref<Set<string>>
  pickedTags:        Ref<Set<string>>
  pickedMembers:     Ref<Set<string>>
  pickedReviewedBy:  Ref<Set<ReviewedByPick>>
  pickedQueues:      Ref<Set<QueuePick>>
  pickedPlayModes:   Ref<Set<PlayModePick>>
  pickedSources:     Ref<Set<SourcePick>>
  pickedLeavers:     Ref<Set<LeaverPick>>
  pickedModifiers:   Ref<Set<string>>
  pickedRanks:       Ref<Set<string>>
  pickedRange:       Ref<PresetRange>
  customFrom:        Ref<string>
  customTo:          Ref<string>
  leaverHandling:    Ref<LeaverHandling>
  minPlayMinutes:    Ref<number>
  minPlayPercent:    Ref<number>
  includeUnknown:    Ref<boolean>
  // "Since this match" anchor. `anchorKey` is the match_key of the
  // anchor (empty string ≡ none). The ref is OWNED by
  // `useMatchAnchor` and threaded in here as a `ComputedRef` —
  // reactive on read, but type-rejected on write so callers can't
  // bypass the persistence layer. Tests supply a `computed(() => x)`
  // wrapping a plain ref. `sinceAnchorActive` is the panel-local
  // "apply the anchor filter?" toggle, session-scoped and reset by
  // resetNarrow.
  anchorKey:         ComputedRef<string>
  sinceAnchorActive: Ref<boolean>
}

export interface CreateMatchesNarrowStateOptions {
  anchorKey?: ComputedRef<string>
}
