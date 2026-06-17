/**
 * Real-server backup round-trip — GET /api/v1/exports?format=json then
 * POST /api/v1/imports against the actual binary, so pkg/app/export.go (the
 * recall-export/v1 payload) and the import path (importJSONv1 → DB replace) run
 * for real. Verifies every row plus the annotation and hidden sidecars survive a
 * full export → wipe → import cycle. No api mocking.
 *
 * NB: this is the backup/restore format (recall-export/v1). The /exports/bundle
 * ZIP is a separate share format (recall-bundle/v1 envelope + screenshots) that
 * /imports does not unwrap.
 */
import { expect, test } from './_fixtures'
import { createMatch, listMatches, manual, reset } from './_real-server'

test.describe('backup round-trip (real server)', () => {
  test.beforeEach(async ({ request }) => reset(request))
  test.afterEach(async ({ request }) => reset(request))

  test('export then import preserves rows, annotation, and hidden flag', async ({ request }) => {
    // Three matches: one hidden, one annotated, one plain.
    const hiddenM = await createMatch(request, manual({ played_at: '2026-06-15T18:00:00Z' }))
    const notedM = await createMatch(request, manual({ played_at: '2026-06-15T18:01:00Z', note: 'great comeback' }))
    await createMatch(request, manual({ played_at: '2026-06-15T18:02:00Z' }))
    expect((await request.put(`/api/v1/matches/${encodeURIComponent(hiddenM.match_key)}/visibility`, { data: { hidden: true } })).status()).toBe(204)

    // Export the whole DB (recall-export/v1 JSON).
    const exp = await request.get('/api/v1/exports?format=json')
    expect(exp.status()).toBe(200)
    const payload = await exp.body()
    expect(payload.byteLength).toBeGreaterThan(0)

    // Wipe to a fresh install, then import the payload back.
    await reset(request)
    expect(await listMatches(request)).toHaveLength(0)

    const imp = await request.post('/api/v1/imports', {
      headers: { 'Content-Type': 'application/json' },
      data: payload,
    })
    expect(imp.status(), await imp.text().catch(() => '')).toBe(204)

    // Every match came back, with its sidecars intact.
    const all = await listMatches(request)
    expect(all).toHaveLength(3)
    expect(all.find((m) => m.match_key === hiddenM.match_key)?.hidden).toBe(true)
    expect(all.find((m) => m.match_key === notedM.match_key)?.annotation?.note).toBe('great comeback')
  })
})
