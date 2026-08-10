import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { qk, matchesCluster } from '@/queries/keys'
import { queryClient } from '@/queries/client'
import { useAppStore } from '@/stores/app'

// The defaults ARE the e2e request-count parity mechanism: retries off
// (the error banner is the retry UX), staleTime/gcTime Infinity (nothing
// refetches on tab switches — the four views are v-if-mounted), focus and
// reconnect refetches off (the no-network-unless-asked rule), networkMode
// 'always' (navigator.onLine false must not pause same-process calls).
describe('queryClient defaults', () => {
  const d = queryClient.getDefaultOptions()

  it('never auto-retries', () => {
    expect(d.queries?.retry).toBe(false)
    expect(d.mutations?.retry).toBe(false)
  })

  it('never refetches on remount, focus, or reconnect', () => {
    expect(d.queries?.staleTime).toBe(Infinity)
    expect(d.queries?.gcTime).toBe(Infinity)
    expect(d.queries?.refetchOnWindowFocus).toBe(false)
    expect(d.queries?.refetchOnReconnect).toBe(false)
  })

  it('ignores navigator.onLine (the backend is same-process)', () => {
    expect(d.queries?.networkMode).toBe('always')
    expect(d.mutations?.networkMode).toBe('always')
  })
})

describe('matchesCluster', () => {
  it('is exactly the three reads the old load() refetched together', () => {
    expect(matchesCluster).toEqual([qk.matches, qk.pendingCount, qk.failedFiles])
  })
})

// meta.banner routes query failures into the global error banner with an
// identity-stable retry fn — preserving the `errorRetry === load` contract
// the banner's clear-on-success logic relies on.
describe('QueryCache banner integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    queryClient.clear()
  })

  it('arms the banner with a stable retry on a meta.banner query failure', async () => {
    const app = useAppStore()
    await queryClient.fetchQuery({
      queryKey: ['banner-test'],
      queryFn: () => Promise.reject(new Error('connection refused')),
      meta: { banner: 'Could not load matches' },
    }).catch(() => undefined)

    expect(app.error).toContain('Could not load matches')
    expect(app.errorRetry).toBeTypeOf('function')

    // A second failure must produce the SAME retry identity.
    const firstRetry = app.errorRetry
    await queryClient.fetchQuery({
      queryKey: ['banner-test'],
      queryFn: () => Promise.reject(new Error('still down')),
      meta: { banner: 'Could not load matches' },
    }).catch(() => undefined)
    expect(app.errorRetry).toBe(firstRetry)
  })

  it('clears the banner when the same query later succeeds', async () => {
    const app = useAppStore()
    await queryClient.fetchQuery({
      queryKey: ['banner-test'],
      queryFn: () => Promise.reject(new Error('boom')),
      meta: { banner: 'Could not load matches' },
    }).catch(() => undefined)
    expect(app.error).not.toBe('')

    await queryClient.fetchQuery({
      queryKey: ['banner-test'],
      queryFn: () => Promise.resolve([]),
      meta: { banner: 'Could not load matches' },
    })
    expect(app.error).toBe('')
    expect(app.errorRetry).toBeNull()
  })

  it('leaves the banner alone for queries without meta.banner', async () => {
    const app = useAppStore()
    await queryClient.fetchQuery({
      queryKey: ['silent-test'],
      queryFn: () => Promise.reject(new Error('quietly kept-last')),
    }).catch(() => undefined)
    expect(app.error).toBe('')
  })

  it('a meta.retryKeys banner Retry refetches every listed key, not just the one that failed', async () => {
    const app = useAppStore()
    const siblingFn = vi.fn(() => Promise.resolve('sibling'))
    // Prime the sibling so a refetch has an existing query to hit.
    await queryClient.fetchQuery({ queryKey: ['retry-sibling'], queryFn: siblingFn })

    await queryClient.fetchQuery({
      queryKey: ['retry-primary'],
      queryFn: () => Promise.reject(new Error('down')),
      meta: {
        banner: 'Could not load matches',
        retryKeys: [['retry-primary'], ['retry-sibling']],
      },
    }).catch(() => undefined)

    expect(app.errorRetry).toBeTypeOf('function')
    await app.errorRetry?.()
    await new Promise(r => setTimeout(r, 0))
    // The old banner Retry re-ran the whole load() cluster; the query-era
    // Retry must keep that scope, or pending-count/failed-files stay stale
    // after an outage heals.
    expect(siblingFn).toHaveBeenCalledTimes(2)
  })

  it('does not clear a banner armed by a DIFFERENT query', async () => {
    const app = useAppStore()
    await queryClient.fetchQuery({
      queryKey: ['banner-test'],
      queryFn: () => Promise.reject(new Error('boom')),
      meta: { banner: 'Could not load matches' },
    }).catch(() => undefined)

    await queryClient.fetchQuery({
      queryKey: ['other-query'],
      queryFn: () => Promise.resolve('ok'),
      meta: { banner: 'Could not load settings' },
    })
    expect(app.error).toContain('Could not load matches')
  })
})
