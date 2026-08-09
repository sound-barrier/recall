import { ref, computed, watch, type MaybeRefOrGetter, toValue } from 'vue'
import { ApplyGameDataUpdate, ApiError, type UpdateInfo, type DataUpdateResult } from '@/api-client'
import { queryClient } from '@/queries/client'
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
    return (g.added_heroes?.length ?? 0) + (g.added_maps?.length ?? 0) + (g.added_sources?.length ?? 0) + (g.added_seasons?.length ?? 0)
  })
  const removedCount = computed(() => {
    const g = gameData.value
    return (g.removed_heroes?.length ?? 0) + (g.removed_maps?.length ?? 0) + (g.removed_sources?.length ?? 0) + (g.removed_seasons?.length ?? 0)
  })
  // Changed seasons (same name, shifted window) are neither added nor removed.
  const changedCount = computed(() => gameData.value.changed_seasons?.length ?? 0)
  const changeCount = computed(() => addedCount.value + removedCount.value + changedCount.value)

  // Every changed name, grouped by kind, in one flat list: added heroes →
  // maps → sources, then removed, so additions (the common case) lead.
  const diffRows = computed<DiffRow[]>(() => {
    const g = gameData.value
    const rows: DiffRow[] = []
    for (const h of g.added_heroes   ?? []) rows.push({ kind: 'Hero',   sign: '+', name: h })
    for (const m of g.added_maps     ?? []) rows.push({ kind: 'Map',    sign: '+', name: m })
    for (const s of g.added_sources  ?? []) rows.push({ kind: 'Source', sign: '+', name: s })
    for (const h of g.removed_heroes ?? []) rows.push({ kind: 'Hero',   sign: '−', name: h })
    for (const m of g.removed_maps   ?? []) rows.push({ kind: 'Map',    sign: '−', name: m })
    for (const s of g.removed_sources?? []) rows.push({ kind: 'Source', sign: '−', name: s })
    for (const s of g.added_seasons   ?? []) rows.push({ kind: 'Season', sign: '+', name: s })
    for (const s of g.changed_seasons ?? []) rows.push({ kind: 'Season', sign: '~', name: s })
    for (const s of g.removed_seasons ?? []) rows.push({ kind: 'Season', sign: '−', name: s })
    return rows
  })

  // "2 new heroes, 1 new map available" — the headline a player actually reads,
  // built from the added-name lists (additions are the common, interesting case;
  // retirements stay in the manifest below).
  const changeSummary = computed(() => {
    const g = gameData.value
    const seg = (n: number, one: string, many: string) => (n > 0 ? `${n} new ${n === 1 ? one : many}` : '')
    const parts = [
      seg(g.added_heroes?.length ?? 0, 'hero', 'heroes'),
      seg(g.added_maps?.length ?? 0, 'map', 'maps'),
      seg(g.added_sources?.length ?? 0, 'screenshot source', 'screenshot sources'),
      seg(g.added_seasons?.length ?? 0, 'season', 'seasons'),
    ].filter(Boolean)
    const changedSeasons = g.changed_seasons?.length ?? 0
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
      void queryClient.invalidateQueries({ queryKey: qk.system.referenceData })
      applyState.value = { kind: 'success', result }
      onApplied(result)
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null
      const message = apiErr
        ? apiErr.body || `Apply failed (HTTP ${apiErr.status})`
        : (err instanceof Error ? err.message : String(err))
      applyState.value = { kind: 'error', message }
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
