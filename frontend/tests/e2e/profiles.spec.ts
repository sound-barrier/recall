/**
 * Real-server profile suite — drives the actual binary so pkg/app/profile_app.go's
 * teardown/re-init (store, watcher, metrics swap atomically per profile) and
 * pkg/app/profile_move.go's two-phase transfer run against real SQLite DBs. No
 * api mocking.
 *
 *   1. Lifecycle: create → switch → isolate → delete (per-profile DB isolation).
 *   2. Cross-profile move: POST /matches/transfers — source loses the match, the
 *      target gains it, and the hidden sidecar survives the transfer.
 */
import { expect, test } from './_fixtures'
import { createMatch, getProfiles, listMatches, manual, reset, switchProfile } from './_real-server'

test.describe('profiles (real server)', () => {
  test.beforeEach(async ({ request }) => reset(request))

  test.afterEach(async ({ request }) => reset(request))

  test('create, switch, isolate, and delete a profile', async ({ request }) => {
    // Fresh install: a single empty "main".
    expect(await getProfiles(request)).toEqual({ active: 'main', profiles: ['main'] })

    // Create "alt" — the server activates it.
    expect((await request.post('/api/v1/profiles', { data: { name: 'alt' } })).status()).toBe(201)
    const p = await getProfiles(request)
    expect(p.active).toBe('alt')
    expect([...p.profiles].sort()).toEqual(['alt', 'main'])

    // A match created now lands in "alt".
    await createMatch(request, manual({ played_at: '2026-06-15T14:00:00Z' }))
    expect(await listMatches(request)).toHaveLength(1)

    // Switch to "main": isolation — none of "alt"'s data leaks.
    await switchProfile(request, 'main')
    expect(await listMatches(request)).toHaveLength(0)

    // Back on "alt", the match is still there (separate DB).
    await switchProfile(request, 'alt')
    expect(await listMatches(request)).toHaveLength(1)

    // Delete "alt" (from "main" — the active profile can't be deleted).
    await switchProfile(request, 'main')
    expect((await request.delete('/api/v1/profiles/alt')).status()).toBe(204)
    expect(await getProfiles(request)).toEqual({ active: 'main', profiles: ['main'] })
  })

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
