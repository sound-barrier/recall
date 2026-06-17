/**
 * Real-server input-validation paths — drive the rejection codes through the
 * actual binary so the validation Go (usermatch range/roster checks, the import
 * malformed-payload guard) is exercised end-to-end. These are the 400/409 paths
 * the recent data-loss/validation fixes added; the mocked specs never hit them.
 */
import { expect, test } from './_fixtures'
import { createMatch, manual, reset } from './_real-server'

test.describe('input validation (real server)', () => {
  test.beforeEach(async ({ request }) => reset(request))
  test.afterEach(async ({ request }) => reset(request))

  test('manual create rejects out-of-range rank (400) and unknown map/hero (409)', async ({ request }) => {
    const post = (body: Record<string, unknown>) => request.post('/api/v1/matches', { data: body })

    // Out-of-range rank progress → 400.
    expect((await post(manual({ rank: { tier: 'platinum', division: 3, progress: 150, change_percent: 0 } }))).status()).toBe(400)
    // Unknown map / hero are spec-valid free-text → 409 (semantic rejection).
    expect((await post(manual({ map: 'notamap' }))).status()).toBe(409)
    expect((await post(manual({ heroes: ['notahero'] }))).status()).toBe(409)
    // Missing required map → 400.
    expect((await post(manual({ map: '' }))).status()).toBe(400)
    // A fully valid one still succeeds.
    expect((await post(manual({ played_at: '2026-06-15T14:30:00Z' }))).status()).toBe(201)
  })

  test('inline edit rejects out-of-range stats (400) and unknown map/hero (409)', async ({ request }) => {
    const m = await createMatch(request, manual({ played_at: '2026-06-15T15:00:00Z' }))
    const key = encodeURIComponent(m.match_key)
    const put = (body: Record<string, unknown>) => request.put(`/api/v1/matches/${key}/data`, { data: body })

    expect((await put({ damage: -1 })).status()).toBe(400) // negative stat
    expect((await put({ rank_progress: 101 })).status()).toBe(400) // out of 0-100
    expect((await put({ map: 'notamap' })).status()).toBe(409) // unknown map
    expect((await put({ hero: 'notahero' })).status()).toBe(409) // unknown hero
    expect((await put({ damage: 4200 })).status()).toBe(204) // a valid override still applies
  })

  test('import rejects a malformed payload (400)', async ({ request }) => {
    const r = await request.post('/api/v1/imports', {
      headers: { 'Content-Type': 'application/json' },
      data: 'this is neither json nor a zip',
    })
    expect(r.status()).toBe(400)
  })
})
