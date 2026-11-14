import { computed, type ComputedRef } from 'vue'
import type { NamedCandidateStats } from '@/api-client'
import { useCandidateStatsQuery } from '@/queries/settings'

// useScreenshotFolderStats reads the per-source diagnostic blobs for the
// picker grid. The query mounts with the cards, so the directory walk runs
// after the grid renders; each card subscribes to its own entry via
// `statsFor(name)` and the second metadata line surfaces once the answer
// lands. Server truth, so it lives in the query cache (qk.candidateStats) —
// read once per session, shared by every picker on screen.
//
// Empty until the read resolves. On error the list stays empty — the cards
// just don't surface a second line; no toast / error UI (this is enrichment,
// not a load-bearing feature).

export interface ScreenshotFolderStatsApi {
  stats:     ComputedRef<Map<NamedCandidateStats['name'], NamedCandidateStats>>
  loading:   ComputedRef<boolean>
  statsFor:  (name: NamedCandidateStats['name']) => NamedCandidateStats | null
}

export function useScreenshotFolderStats(): ScreenshotFolderStatsApi {
  const query = useCandidateStatsQuery()
  const stats = computed(() => new Map((query.data.value ?? []).map((s) => [s.name, s] as const)))
  const loading = computed(() => query.isFetching.value)

  function statsFor(name: NamedCandidateStats['name']): NamedCandidateStats | null {
    return stats.value.get(name) ?? null
  }

  return { stats, loading, statsFor }
}
