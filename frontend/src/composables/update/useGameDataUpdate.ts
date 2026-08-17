import { ref, computed, watch, type MaybeRefOrGetter, toValue } from 'vue'
import { ApplyGameDataUpdate, ApiError, type UpdateInfo, type DataUpdateResult } from '@/api-client'
import { getQueryClient } from '@/queries/client'
import { qk } from '@/queries/keys'

// The game-data half of the update-check modal: the from→to freshness
// labels, the added/removed counts, the flat diff manifest, and the
// apply→verify→success/error state machine. Extracted from UpdateCheckModal
// so the SFC keeps the modal chrome + markup and this composable holds the
// game-data logic. `open` re-arms the apply state each time the modal opens;
// `onApplied` lifts the successful result back to the parent.
export type GameDataApplyState =
  | { kind: 'idle' }
  | { kind: 'applying' }
  | { kind: 'success', result: DataUpdateResult }
  | { kind: 'error', message: string }

export type DiffRow = { kind: 'Hero' | 'Map' | 'Source' | 'Season', sign: '+' | '−' | '~', name: string }

const len = (names: string[] | undefined) => names?.length ?? 0

// One "N new <noun>" headline segment; empty when nothing was added.
const seg = (n: number, one: string, many: string) => (n > 0 ? `${n} new ${n === 1 ? one : many}` : '')

export function useGameDataUpdate(
  updateInfo: MaybeRefOrGetter<UpdateInfo | null>,
  open: MaybeRefOrGetter<boolean>,
  onApplied: (result: DataUpdateResult) => void,
) {
  const applyState = ref<GameDataApplyState>({ kind: 'idle' })

  // Re-arm Apply when the modal re-opens.
  watch(() => toValue(open), (isOpen) => {
    if (isOpen) applyState.value = { kind: 'idle' }
  })

  const gameData = computed(() =>
    toValue(updateInfo)?.game_data ?? { commit_sha: '', applied_commit: '', has_update: false })

  // Added/removed are separate because they read differently in the UI
  // ("3 NEW · 1 RETIRED" splits visually into gain vs loss).
  const addedCount = computed(() => {
    const g = gameData.value
    return len(g.added_heroes) + len(g.added_maps) + len(g.added_sources) + len(g.added_seasons)
  })
  const removedCount = computed(() => {
    const g = gameData.value
    return len(g.removed_heroes) + len(g.removed_maps) + len(g.removed_sources) + len(g.removed_seasons)
  })
  // Changed seasons (same name, shifted window) are neither added nor removed.
  const changedCount = computed(() => len(gameData.value.changed_seasons))
  const changeCount = computed(() => addedCount.value + removedCount.value + changedCount.value)

  // Every changed name, grouped by kind, in one flat list: added heroes →
  // maps → sources, then removed, so additions (the common case) lead.
  const diffRows = computed<DiffRow[]>(() => {
    const g = gameData.value
    const sections: [DiffRow['kind'], DiffRow['sign'], string[] | undefined][] = [
      ['Hero',   '+', g.added_heroes],
      ['Map',    '+', g.added_maps],
      ['Source', '+', g.added_sources],
      ['Hero',   '−', g.removed_heroes],
      ['Map',    '−', g.removed_maps],
      ['Source', '−', g.removed_sources],
      ['Season', '+', g.added_seasons],
      ['Season', '~', g.changed_seasons],
      ['Season', '−', g.removed_seasons],
    ]
    return sections.flatMap(([kind, sign, names]) => (names ?? []).map((name) => ({ kind, sign, name })))
  })

  // "2 new heroes, 1 new map available" — the headline a player actually reads,
  // built from the added-name lists (additions are the common, interesting case;
  // retirements stay in the manifest below).
  const changeSummary = computed(() => {
    const g = gameData.value
    const parts = [
      seg(len(g.added_heroes), 'hero', 'heroes'),
      seg(len(g.added_maps), 'map', 'maps'),
      seg(len(g.added_sources), 'screenshot source', 'screenshot sources'),
      seg(len(g.added_seasons), 'season', 'seasons'),
    ].filter(Boolean)
    const changedSeasons = len(g.changed_seasons)
    if (changedSeasons > 0) parts.push(`${changedSeasons} season${changedSeasons === 1 ? '' : 's'} updated`)
    return parts.length ? `${parts.join(', ')} available` : ''
  })

  // Freshness reports CONTENT, not age. When the live rosters match what the app
  // has (has_update false), the data is current no matter how long ago it was
  // applied — showing "N days old" there reads as stale when nothing shipped. The
  // age of applied data is deliberately never surfaced; the change summary above
  // carries the only thing a player cares about when there IS an update.
  const dataFreshnessLabel = computed(() => {
    const g = gameData.value
    if (!g.applied_commit) return 'Currently using the built-in roster'
    return g.has_update ? 'A roster update is available' : 'Your roster is up to date'
  })

  const canApply = computed(() => {
    const g = gameData.value
    return g.has_update && !!g.commit_sha
  })

  async function onApply() {
    if (!canApply.value) return
    applyState.value = { kind: 'applying' }
    try {
      const result = await ApplyGameDataUpdate()
      // The parser dataset just changed — refresh the cached roster so
      // hero/map lookups pick up the new names without a restart (the old
      // session singleton never refreshed after an apply).
      void getQueryClient().invalidateQueries({ queryKey: qk.system.referenceData })
      applyState.value = { kind: 'success', result }
      onApplied(result)
    } catch (err) {
      applyState.value = { kind: 'error', message: applyErrorMessage(err) }
    }
  }

  return {
    applyState,
    gameData,
    addedCount,
    removedCount,
    changeCount,
    diffRows,
    changeSummary,
    dataFreshnessLabel,
    canApply,
    onApply,
  }
}

function applyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.body || `Apply failed (HTTP ${err.status})`
  return err instanceof Error ? err.message : String(err)
}
