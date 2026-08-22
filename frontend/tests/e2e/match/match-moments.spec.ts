/**
 * The player's own cue strip, in the match journal.
 *
 * The same component the coach's film room uses, on your own match: a
 * self-review that can point at seconds.
 *
 * What this suite proves, and what it cannot. The backend is a `page.route()`
 * mock, so the Go handler, the store and the aggregator never run — a mutation
 * that unregisters the moment routes entirely leaves every case here green.
 * That chain is pinned in Go instead (`TestPerMatchWrites_UnknownKeyIs404`
 * reaches the mux, the pkg/db contract suite reaches both stores, and
 * `TestReParseAll_MatchUpdatedCarriesThePlayersOwnMoments` reaches the wire).
 * What only a browser can show is the leg between them: that a moment typed
 * into the journal leaves on the player's own route — a different path, table
 * and write gate from the coach's — and that what comes back is what renders.
 * So the mock here holds state and answers like a server would, rather than
 * replaying a fixture that would make the round trip pass without one.
 */
import type { Route } from '@playwright/test'

import { routeCapture } from '../_capture'
import { test, expect } from '../_fixtures'

const MATCH_KEY = 'match-2026-08-10T20-00-00'

interface WireMoment {
  moment_id: string
  match_clock: string
  text: string
  focus_tag?: string
}

function record(moments: WireMoment[]) {
  return {
    match_key: MATCH_KEY,
    source_files: ['s.png'],
    source_types: { 's.png': 'summary' },
    data: {
      map: 'rialto', hero: 'juno', role: 'support', result: 'victory',
      playlist: 'competitive', game_mode: 'escort',
      date: '2026-08-10', finished_at: '20:00', game_length: '09:30',
      eliminations: 12, assists: 9, deaths: 4,
    },
    annotation: { replay_code: 'RPL99Z' },
    ...(moments.length ? { moments } : {}),
    parsed_at: '2026-08-10T20:30:00Z',
  }
}

const strip = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Moments' })

async function openJournal(page: import('@playwright/test').Page, seed: WireMoment[] = []) {
  const put = routeCapture<WireMoment>('match moment PUT body')
  const deletes: string[] = []
  // The mock's own copy of the match's moments. A refetch reads it back, so
  // the strip after a save shows what the SERVER holds — not the fixture the
  // page booted with, which would render a saved moment whether or not the
  // response was ever read.
  const held = new Map(seed.map((m) => [m.moment_id, m]))

  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([record([...held.values()])]),
    })
  })
  await page.route('**/api/v1/matches/*/moments/*', async (route: Route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    if (route.request().method() === 'DELETE') {
      deletes.push(id)
      held.delete(id)
      await route.fulfill({ status: 204, body: '' })
      return
    }
    const body = JSON.parse(route.request().postData() ?? '{}') as WireMoment
    put.set(body)
    const saved = { ...body, moment_id: id }
    held.set(id, saved)
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(saved),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await page.locator('.leaf-row').first().click()
  return { put, deletes }
}

test.describe('a player marking their own moments', () => {
  test('invites the first mark on a match with none', async ({ page }) => {
    await openJournal(page)

    await expect(strip(page)).toContainText(/no moments yet/i)
  })

  test('sends a marked moment to the player’s own endpoint, and keeps what comes back', async ({ page }) => {
    const { put } = await openJournal(page)

    await strip(page).getByRole('button', { name: 'Mark a moment' }).click()
    const draft = () => strip(page).getByRole('group', { name: /^New moment/ })
    await draft().getByLabel('Clock').pressSequentially('445')
    await draft().getByLabel('What happened').fill('Should have taken the off-angle.')

    await expect.poll(() => put.seen()).toBe(true)
    expect(put.get().match_clock).toBe('04:45')
    expect(put.get().text).toBe('Should have taken the off-angle.')

    // The saved row settles into the strip proper. The draft is released the
    // moment the server accepts it, so a row still standing here — with the
    // words in it — can only be the copy that came back.
    const saved = strip(page).getByRole('group', { name: /^Moment 1 of 1/ })
    await expect(saved.getByLabel('What happened')).toHaveValue('Should have taken the off-angle.')
    await expect(strip(page).getByRole('group', { name: /^Moment/ })).toHaveCount(1)
  })

  test('orders the strip by the clock, not by the order they arrived', async ({ page }) => {
    // Deliberately reversed on the wire: sorted input passes for an
    // implementation that does not sort at all.
    await openJournal(page, [
      { moment_id: 'b', match_clock: '04:45', text: 'later' },
      { moment_id: 'a', match_clock: '03:23', text: 'earlier' },
    ])

    // Read off the FIELDS. The clock used to be printed a second time beside
    // each one, so a moment displayed its time twice; there is one now, and
    // the field is it.
    const clocks = await strip(page).getByLabel('Clock')
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
    expect(clocks).toEqual(['03:23', '04:45'])
  })

  // A coach transcribing moments off a replay was reaching for the colon key
  // every single time. The field is always MM:SS, so the colon is never
  // absent and the digits shift in from the right.
  test('takes a clock as bare digits, with no colon to type', async ({ page }) => {
    const { put } = await openJournal(page, [])

    await strip(page).getByRole('button', { name: 'Mark a moment' }).click()
    const draft = () => strip(page).getByRole('group', { name: /^New moment/ })
    const clock = draft().getByLabel('Clock')

    await clock.click()
    await clock.pressSequentially('412')
    await expect(clock).toHaveValue('04:12')

    // The colon does nothing rather than breaking the value.
    await clock.press(':')
    await expect(clock).toHaveValue('04:12')

    await draft().getByLabel('What happened').fill('Rotated late.')
    await expect.poll(() => put.seen()).toBe(true)
    expect(put.get().match_clock).toBe('04:12')
  })

  test('drops one the player takes back, and it stays gone', async ({ page }) => {
    const { deletes } = await openJournal(page, [
      { moment_id: 'a', match_clock: '03:23', text: 'earlier' },
    ])

    await strip(page).getByRole('group', { name: /Moment 1 of 1/ })
      .getByRole('button', { name: /remove/i }).click()

    await expect.poll(() => deletes).toEqual(['a'])
    // The refetch reads the server's copy back: gone there means gone here.
    await expect(strip(page)).toContainText(/no moments yet/i)
  })
})
