import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'

import type { MatchRecord } from '@/api-client'
import { emptyDraft, tallyFocus, type CoachNoteDraft, type FocusCount } from '@/match/coach/coach-notes'
import { flattenReel, groupReelByPlayerDay, neighborKey, type ReelDay } from '@/match/coach/coach-reel-helpers'
import { winrateOrNull } from '@/match/dossier/match-dossier-tally'
import { tallyWLD, type WLDTally } from '@/match/match-stats-helpers'
import { railTendencies, type RailTendency } from '@/match/coach/coach-rail-helpers'

// Everything the Film Room derives from the loaned corpus + the coach's
// notes: the reel, which frame is on the desk, its neighbors, and the
// session's running tallies. Pure — the room's components take these as
// props, and the store that owns the session wires them in.

export interface CoachRoomOptions {
  /** The player's loaned records (already the session's corpus, never the coach's). */
  records: MaybeRefOrGetter<MatchRecord[]>
  /** The coach's drafts, keyed by match key. */
  notes: MaybeRefOrGetter<Record<string, CoachNoteDraft>>
  /** The frame the coach picked; '' (or a key no longer on the reel) lands on the first frame. */
  selectedKey: MaybeRefOrGetter<string>
}

export interface CoachRoomApi {
  reelDays: ComputedRef<ReelDay<MatchRecord>[]>
  /** Every frame in reel order — the sequence prev/next walks. */
  frames: ComputedRef<MatchRecord[]>
  /** The key actually on the desk; '' only when the reel is empty. */
  activeKey: ComputedRef<string>
  selectedRecord: ComputedRef<MatchRecord | null>
  /** The draft for the active frame — an empty draft when the coach hasn't written one. */
  activeDraft: ComputedRef<CoachNoteDraft>
  wld: ComputedRef<WLDTally>
  winRate: ComputedRef<number | null>
  focusTally: ComputedRef<FocusCount[]>
  /** The stat rail's rows for the frame on the desk — hero, then map. */
  railRows: ComputedRef<RailTendency[]>
  prevKey: ComputedRef<string | null>
  nextKey: ComputedRef<string | null>
}

export function useCoachRoom(opts: CoachRoomOptions): CoachRoomApi {
  const reelDays = computed(() => groupReelByPlayerDay(toValue(opts.records)))
  const frames = computed(() => flattenReel(reelDays.value))

  // The desk always shows something while the reel has frames: a
  // selection the reel no longer carries (a swapped player, a hidden
  // match) falls back rather than blanking the room.
  const activeKey = computed(() => {
    const picked = toValue(opts.selectedKey)
    const onReel = frames.value.some((f) => f.match_key === picked)
    return onReel ? picked : (frames.value[0]?.match_key ?? '')
  })

  const selectedRecord = computed(() => frames.value.find((f) => f.match_key === activeKey.value) ?? null)
  const activeDraft = computed(() => toValue(opts.notes)[activeKey.value] ?? emptyDraft())

  const wld = computed(() => tallyWLD(frames.value))

  // What the player usually does on the frame's own hero and map, read out
  // of the corpus already on screen. Follows the frame, so a coach walking
  // the reel never has to ask for it.
  const railRows = computed(() => railTendencies(frames.value, {
    hero: selectedRecord.value?.data?.hero ?? '',
    map: selectedRecord.value?.data?.map ?? '',
  }))
  const winRate = computed(() => winrateOrNull(wld.value.w, wld.value.w + wld.value.l))
  const focusTally = computed(() => tallyFocus(toValue(opts.notes)))

  const prevKey = computed(() => neighborKey(reelDays.value, activeKey.value, -1))
  const nextKey = computed(() => neighborKey(reelDays.value, activeKey.value, 1))

  return { reelDays, frames, activeKey, selectedRecord, activeDraft, wld, winRate, focusTally, railRows, prevKey, nextKey }
}
