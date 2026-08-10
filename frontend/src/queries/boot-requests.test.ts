import { describe, it, expect } from 'vitest'

import { fireBackendEvent, renderApp, mockedApi } from '@/test-utils'

// The store-setup observers ARE the boot fetch — useAppBoot must not
// refetch the cluster on top of them (refetchQueries cancels the in-flight
// initial fetches and re-issues all three GETs: 6 requests where 3 do).
describe('boot request dedup', () => {
  it('boot issues each matches-cluster read exactly once', async () => {
    await renderApp()
    const api = mockedApi()
    expect(api.GetMatchResults).toHaveBeenCalledTimes(1)
    expect(api.GetNewScreenshotCount).toHaveBeenCalledTimes(1)
    expect(api.GetFailedFiles).toHaveBeenCalledTimes(1)
  })
})

// The match-updated upsert must operate on the qk.matches CACHE, never the
// store's tour-aware records view — during the onboarding tour the view
// hands out demo data, and writing that back would poison the user's real
// match history (staleTime Infinity would then keep it).
describe('match-updated upsert vs the tour overlay', () => {
  it('a tour-time upsert lands in the cache without the demo records', async () => {
    // fireBackendEvent comes from the STATIC import above — renderApp's
    // resetModules means a dynamic re-import of the test-utils module
    // would resolve a fresh instance with an empty handler map. The app
    // chain (stores/queries) is the opposite: it must be imported AFTER
    // renderApp so it resolves the same instances the mounted App uses.
    const view = await renderApp()
    const { useMatchesStore } = await import('@/stores/matches')
    const { getQueryClient } = await import('@/queries/client')
    const { qk } = await import('@/queries/keys')

    const matches = useMatchesStore()
    await matches.onTourActiveChange(true)
    expect(matches.records.length).toBeGreaterThan(0) // demo overlay showing

    const rec = { match_key: 'match-2026-08-09T20-00-00', source_files: [], data: {} }
    expect(fireBackendEvent('match-updated', rec)).toBe(true)
    await new Promise(r => setTimeout(r, 0))

    const cached = getQueryClient().getQueryData<{ match_key: string }[]>(qk.matches) ?? []
    expect(cached.map(r => r.match_key)).toContain(rec.match_key)
    // No demo record may leak into the canonical cache.
    expect(cached.every(r => !matches.records.some(
      d => d.match_key === r.match_key && r.match_key !== rec.match_key,
    ))).toBe(true)

    await matches.onTourActiveChange(false)
    view.unmount()
  })
})
