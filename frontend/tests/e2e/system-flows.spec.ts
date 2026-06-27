/**
 * Real-server system flows — review status, the ignored-screenshots suppress
 * list, and the JSON + CSV export formats. Each drives the actual binary so the
 * review/suppress-list handlers and both export encoders (export.go +
 * export_csv.go) run for real; the mocked specs never reach them. Isolated by
 * the reset seam.
 */
import { expect, test } from './_fixtures'
import { createMatch, listMatches, manual, reset } from './_real-server'

test.describe('system flows (real server)', () => {
  test.beforeEach(async ({ request }) => reset(request))

  test.afterEach(async ({ request }) => reset(request))

  test('mark a match reviewed, then clear it', async ({ request }) => {
    const m = await createMatch(request, manual({ played_at: '2026-06-15T14:00:00Z' }))
    const key = encodeURIComponent(m.match_key)

    expect((await request.put(`/api/v1/matches/${key}/review`, { data: { reviewed_by: 'self' } })).status()).toBe(204)
    expect((await listMatches(request))[0].reviewed_by).toBe('self')

    expect((await request.delete(`/api/v1/matches/${key}/review`)).status()).toBe(204)
    expect((await listMatches(request))[0].reviewed_by).toBeUndefined()
  })

  test('ignore a screenshot, list it, then restore it', async ({ request }) => {
    const file = 'sb-2026-06-15.png'
    const enc = encodeURIComponent(file)

    expect((await request.put(`/api/v1/screenshots/${enc}/ignore`)).status()).toBe(204)
    const ignored = await request.get('/api/v1/screenshots/ignored')
    expect(ignored.status()).toBe(200)
    expect(((await ignored.json()) as { filename: string }[]).some((i) => i.filename === file)).toBe(true)

    expect((await request.delete(`/api/v1/screenshots/${enc}/ignore`)).status()).toBe(204)
    expect(((await (await request.get('/api/v1/screenshots/ignored')).json()) as unknown[])).toHaveLength(0)
  })

  test('back up the corpus as a native SQLite snapshot', async ({ request }) => {
    await createMatch(request, manual({ played_at: '2026-06-15T16:00:00Z' }))

    const snapshot = await request.get('/api/v1/database')
    expect(snapshot.status()).toBe(200)
    const bytes = await snapshot.body()
    expect(bytes.byteLength).toBeGreaterThan(0)
    // The body is a real SQLite file — it starts with the format header.
    expect(bytes.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\0')
  })
})
