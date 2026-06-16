/**
 * Real-server match round-trips — NO api mocking. Each request hits the actual
 * `serveronly` binary, so the Go handler → app → store → aggregate/correlate →
 * read-time inference chain is exercised end-to-end (this is what lifts Go
 * integration coverage; the mocked specs never touch it).
 *
 * State is isolated by the RECALL_E2E-gated POST /api/v1/system/test-reset seam
 * (reset to a single empty "main" profile) in beforeEach + afterEach, so the
 * shared single-process SQLite never bleeds between tests or into the
 * empty-assuming specs (smoke/a11y).
 */
import type { APIRequestContext } from '@playwright/test'

import { expect, test } from './_fixtures'

const RESET = '/api/v1/system/test-reset'

interface Match {
  match_key: string
  source?: string
  hidden?: boolean
  queue_type?: string
  data?: {
    map?: string
    result?: string
    damage?: number
    heroes_played?: { hero: string; percent_played?: number }[]
  }
}

function manual(overrides: Record<string, unknown> = {}) {
  return { map: 'ilios', play_mode: 'competitive', queue_type: 'open', heroes: ['ana'], result: 'victory', ...overrides }
}

async function reset(request: APIRequestContext) {
  expect((await request.post(RESET)).status()).toBe(204)
}

async function create(request: APIRequestContext, body: Record<string, unknown>): Promise<Match> {
  const r = await request.post('/api/v1/matches', { data: body })
  expect(r.status(), await r.text()).toBe(201)
  return r.json() as Promise<Match>
}

async function list(request: APIRequestContext): Promise<Match[]> {
  const r = await request.get('/api/v1/matches')
  expect(r.status()).toBe(200)
  return r.json() as Promise<Match[]>
}

test.describe('matches round-trip (real server)', () => {
  test.beforeEach(async ({ request }) => reset(request))
  test.afterEach(async ({ request }) => reset(request))

  test('manual create aggregates and infers the sole-hero percent on read', async ({ request }) => {
    const rec = await create(request, manual({ played_at: '2026-06-15T14:30:00Z' }))
    expect(rec.source).toBe('manual')

    const all = await list(request)
    expect(all).toHaveLength(1)
    expect(all[0].data?.map).toBe('ilios')
    expect(all[0].data?.result).toBe('victory')
    // Read-time inference: a single hero with no recorded percent → 100 on read.
    expect(all[0].data?.heroes_played?.[0]?.percent_played).toBe(100)
  })

  test('inline edit overrides a stat', async ({ request }) => {
    const rec = await create(request, manual({ played_at: '2026-06-15T15:00:00Z' }))
    const put = await request.put(`/api/v1/matches/${encodeURIComponent(rec.match_key)}/data`, { data: { damage: 5000 } })
    expect(put.status()).toBe(204)

    const all = await list(request)
    expect(all[0].data?.damage).toBe(5000)
  })

  test('bulk queue updates every selected match in one call', async ({ request }) => {
    const a = await create(request, manual({ played_at: '2026-06-15T16:00:00Z' }))
    const b = await create(request, manual({ played_at: '2026-06-15T16:01:00Z' }))
    const put = await request.put('/api/v1/matches/queue', {
      data: { match_keys: [a.match_key, b.match_key], queue_type: 'role' },
    })
    expect(put.status()).toBe(204)

    const all = await list(request)
    expect(all).toHaveLength(2)
    expect(all.every((m) => m.queue_type === 'role')).toBe(true)
  })

  test('hide flags the match, then hard-delete removes it', async ({ request }) => {
    const rec = await create(request, manual({ played_at: '2026-06-15T17:00:00Z' }))
    const key = encodeURIComponent(rec.match_key)

    const hide = await request.put(`/api/v1/matches/${key}/visibility`, { data: { hidden: true } })
    expect(hide.status()).toBe(204)
    expect((await list(request)).find((m) => m.match_key === rec.match_key)?.hidden).toBe(true)

    const del = await request.delete(`/api/v1/matches/${key}`)
    expect(del.status()).toBe(204)
    expect((await list(request)).find((m) => m.match_key === rec.match_key)).toBeUndefined()
  })
})
