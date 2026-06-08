import { onMounted, ref, type Ref } from 'vue'
import { GetScreenshotsFolderCandidateStats, type NamedCandidateStats } from '../api'

// useScreenshotFolderStats fetches the per-source diagnostic blobs
// for the picker grid AFTER the cards mount. The dir walk can take a
// few seconds on a synced cloud folder; running it as a side-fetch
// keeps the grid render snappy. Each card subscribes to its own
// entry via `statsFor(name)` and the second metadata line surfaces
// once the response lands.
//
// Empty Map until the fetch resolves. On error the Map stays empty —
// the cards just don't surface a second line; no toast / error UI
// (this is enrichment, not a load-bearing feature).

export interface ScreenshotFolderStatsApi {
  stats:     Ref<Map<NamedCandidateStats['name'], NamedCandidateStats>>
  loading:   Ref<boolean>
  statsFor:  (name: NamedCandidateStats['name']) => NamedCandidateStats | null
}

export function useScreenshotFolderStats(): ScreenshotFolderStatsApi {
  const stats   = ref<Map<NamedCandidateStats['name'], NamedCandidateStats>>(new Map())
  const loading = ref(false)

  onMounted(async () => {
    loading.value = true
    try {
      const list = await GetScreenshotsFolderCandidateStats()
      const next = new Map<NamedCandidateStats['name'], NamedCandidateStats>()
      for (const s of list) next.set(s.name, s)
      stats.value = next
    } catch (_) { /* enrichment-only; failure is silent */ }
    finally {
      loading.value = false
    }
  })

  function statsFor(name: NamedCandidateStats['name']): NamedCandidateStats | null {
    return stats.value.get(name) ?? null
  }

  return { stats, loading, statsFor }
}
