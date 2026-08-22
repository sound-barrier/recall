import type { ComputedRef, Ref } from 'vue'
import type { LeaverHandling } from '@/composables/matches/dossier/useMatchesDossier'

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
// narrow panel exposes only the "somebody put this here" buckets as
// chips — 'ocr_edited' (corrected after parsing), 'manual' (hand-entered,
// no screenshots) and 'replay' (created by a coach's replay review).
// 'ocr' is the fallback bucket for pure parsed matches; it's reachable in
// matchesSource (so picking any chip drops pure-OCR rows) but has no chip
// of its own.
export type SourcePick = 'ocr' | 'ocr_edited' | 'manual' | 'replay'

// DisruptionSide mirrors the `annotation.leavers` / `annotation.throwers`
// vocabulary — which side someone left from or threw on: 'self' (the user
// themselves, so their own data is incomplete), 'team' (a teammate), 'enemy'.
//
// Both annotations are SETS, so a match can be tagged on both teams at once
// and a single match can match either picked side. The two narrow facets are
// independent multi-selects that OR within themselves: empty ≡ no filter, and
// matches carrying no tag of that kind drop out once any side is picked.
//
// `leaverSide` is distinct from `leaverHandling`, which only governs the W/L
// TALLY. There is deliberately no thrower equivalent of leaverHandling — a
// thrown match still counts.
export type DisruptionSide = 'self' | 'team' | 'enemy'
export type LeaverPick = DisruptionSide
export type ThrowerPick = DisruptionSide

// Pool-membership filter — the Hero Pool band's In-pool / Out-of-pool
// selection. Transient and band-driven (NOT saved in narrow presets): the band
// snapshots the current mode's in-pool hero `keys` when a side is picked, and
// the predicate classifies each match against them. `null` ≡ no filter.
export interface PoolFilter {
  side: 'pure' | 'off'
  keys: string[]
  thresholdPct: number
}

// A snapshotted set of match keys shown as one clause — "these matches",
// where "these" is a review: a received coach review's members, or a
// sitting's. Transient like PoolFilter (never saved in presets); the label
// is what the chip says. `null` ≡ no filter.
export interface ReviewSetFilter {
  keys: ReadonlySet<string>
  label: string
}

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
  pickedThrowers:    Ref<Set<ThrowerPick>>
  pickedModifiers:   Ref<Set<string>>
  pickedRanks:       Ref<Set<string>>
  pickedRange:       Ref<PresetRange>
  customFrom:        Ref<string>
  customTo:          Ref<string>
  // Optional minute boundaries ('HH:MM', '' = whole day) tightening the
  // custom From/To days — the patch-drop primitive for future seasons.
  // Panel-owned: every non-panel range write resets them to ''.
  customFromTime:    Ref<string>
  customToTime:      Ref<string>
  // Single-select competitive-season filter — the season NAME ('' = off).
  // The window is resolved at filter time from reference data (ClauseCtx),
  // not stored, so a preset survives a seasons.yaml update.
  pickedSeason:      Ref<string>
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
  // Hero Pool band's In-pool / Out-of-pool narrow (null ≡ off). Transient.
  poolFilter:        Ref<PoolFilter | null>
  reviewSetFilter:   Ref<ReviewSetFilter | null>
}

export interface CreateMatchesNarrowStateOptions {
  anchorKey?: ComputedRef<string>
}
