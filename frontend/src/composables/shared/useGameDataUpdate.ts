import { ref, computed, watch, type MaybeRefOrGetter, toValue } from 'vue'
import { ApplyGameDataUpdate, ApiError, type UpdateInfo, type DataUpdateResult } from '@/api'

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

export type DiffRow = { kind: 'Hero' | 'Map' | 'Source', sign: '+' | '−', name: string }

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
    return (g.added_heroes?.length ?? 0) + (g.added_maps?.length ?? 0) + (g.added_sources?.length ?? 0)
  })
  const removedCount = computed(() => {
    const g = gameData.value
    return (g.removed_heroes?.length ?? 0) + (g.removed_maps?.length ?? 0) + (g.removed_sources?.length ?? 0)
  })
  const changeCount = computed(() => addedCount.value + removedCount.value)

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
    return rows
  })

  // Plain-language age of the user's currently-applied roster data. Commit SHAs
  // mean nothing to a player deciding whether to update, so we never show them.
  function ageInWords(iso?: string): string {
    if (!iso) return ''
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return ''
    const days = Math.floor((Date.now() - then) / 86_400_000)
    if (days <= 0)  return 'less than a day old'
    if (days === 1) return '1 day old'
    if (days < 30)  return `${days} days old`
    const months = Math.floor(days / 30)
    return months === 1 ? '1 month old' : `${months} months old`
  }

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
    ].filter(Boolean)
    return parts.length ? `${parts.join(', ')} available` : ''
  })

  const dataFreshnessLabel = computed(() => {
    const g = gameData.value
    if (!g.applied_commit) return 'Currently using the built-in roster'
    const age = ageInWords(g.applied_at)
    return age ? `Your roster data is ${age}` : 'Your roster data is up to date'
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
