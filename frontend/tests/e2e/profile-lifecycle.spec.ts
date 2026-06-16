/**
 * Real-server profile lifecycle — create → switch → isolate → delete, driving
 * the actual binary so pkg/app/profile_app.go's teardown/re-init (store, watcher,
 * metrics swap atomically per profile) is exercised, and profile DB isolation is
 * verified end-to-end. No api mocking.
 */
import { expect, test } from './_fixtures'
import { createMatch, getProfiles, listMatches, manual, reset, switchProfile } from './_real-server'

test.describe('profile lifecycle (real server)', () => {
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
})
