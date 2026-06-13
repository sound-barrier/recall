import { ref, computed, watch, type MaybeRefOrGetter, toValue } from 'vue'
import { ApplyGameDataUpdate, ApiError, type UpdateInfo, type DataUpdateResult } from '../api'

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

  // "MAIN @ abc1234 · 14 d ago" — relative age, ISO date past 365 d.
  function relativeAge(iso?: string): string {
    if (!iso) return ''
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return ''
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
    if (seconds < 60)                 return 'just now'
    if (seconds < 60 * 60)            return `${Math.floor(seconds / 60)} m ago`
    if (seconds < 60 * 60 * 24)       return `${Math.floor(seconds / 3600)} h ago`
    if (seconds < 60 * 60 * 24 * 365) return `${Math.floor(seconds / 86400)} d ago`
    return new Date(then).toISOString().slice(0, 10)
  }

  const appliedLabel = computed(() => {
    const g = gameData.value
    return g.applied_commit ? `MAIN @ ${g.applied_commit}` : 'EMBEDDED'
  })
  const appliedAgeLabel = computed(() => relativeAge(gameData.value.applied_at))
  const incomingLabel = computed(() => {
    const g = gameData.value
    return g.commit_sha ? `MAIN @ ${g.commit_sha}` : ''
  })
  const incomingAgeLabel = computed(() => relativeAge(gameData.value.committed_at) || 'live')

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
    appliedLabel,
    appliedAgeLabel,
    incomingLabel,
    incomingAgeLabel,
    canApply,
    onApply,
  }
}
