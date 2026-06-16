/**
 * Real-server cross-profile move — POST /api/v1/matches/transfers, driving the
 * actual binary so pkg/app/profile_move.go's two-phase write-target-then-delete-
 * source runs against real SQLite DBs. Verifies the source loses the match, the
 * target gains it, and the hidden sidecar survives the transfer. No api mocking.
 */
import { expect, test } from './_fixtures'
import { createMatch, listMatches, manual, reset, switchProfile } from './_real-server'

test.describe('cross-profile move (real server)', () => {
  test.beforeEach(async ({ request }) => reset(request))
  test.afterEach(async ({ request }) => reset(request))

  test('moves a match to another profile, source loses it and the hidden flag survives', async ({ request }) => {
    // Two matches in "main"; hide one to prove the sidecar moves too.
    const m1 = await createMatch(request, manual({ played_at: '2026-06-15T18:00:00Z' }))
    await createMatch(request, manual({ played_at: '2026-06-15T18:01:00Z' }))
    expect(
      (await request.put(`/api/v1/matches/${encodeURIComponent(m1.match_key)}/visibility`, { data: { hidden: true } })).status(),
    ).toBe(204)

    // Create the target profile (the server activates it), then go back to "main".
    expect((await request.post('/api/v1/profiles', { data: { name: 'archive' } })).status()).toBe(201)
    await switchProfile(request, 'main')
    expect(await listMatches(request)).toHaveLength(2)

    // Move m1 → "archive".
    const move = await request.post('/api/v1/matches/transfers', {
      data: { match_keys: [m1.match_key], target_profile: 'archive' },
    })
    expect(move.status()).toBe(204)

    // Source ("main") lost m1; only the other match remains.
    const mainAfter = await listMatches(request)
    expect(mainAfter).toHaveLength(1)
    expect(mainAfter.find((m) => m.match_key === m1.match_key)).toBeUndefined()

    // Target ("archive") gained m1, hidden flag intact.
    await switchProfile(request, 'archive')
    const archive = await listMatches(request)
    expect(archive).toHaveLength(1)
    expect(archive[0].match_key).toBe(m1.match_key)
    expect(archive[0].hidden).toBe(true)
  })
})
