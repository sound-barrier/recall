/**
 * The player's own cue strip, in the match journal.
 *
 * The same component the coach's film room uses, on your own match: a
 * self-review that can point at seconds. What only an e2e can prove is the
 * transport — that a moment typed into the journal reaches the server on the
 * player's own path (which is a different route, a different table and a
 * different write gate from the coach's) and comes back on the match.
 */
import type { Route } from '@playwright/test'

import { routeCapture } from '../_capture'
import { test, expect } from '../_fixtures'

const MATCH_KEY = 'match-2026-08-10T20-00-00'

function record(moments: unknown[] = []) {
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

async function openJournal(page: import('@playwright/test').Page, moments: unknown[] = []) {
  const put = routeCapture<{ match_clock: string; text: string }>('match moment PUT body')
  const deletes: string[] = []
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([record(moments)]),
    })
  })
  await page.route('**/api/v1/matches/*/moments/*', async (route: Route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    if (route.request().method() === 'DELETE') {
      deletes.push(id)
      await route.fulfill({ status: 204, body: '' })
      return
    }
    const body = JSON.parse(route.request().postData() ?? '{}') as { match_clock: string; text: string }
    put.set(body)
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ moment_id: id, ...body }),
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

  test('sends a marked moment to the player’s own endpoint', async ({ page }) => {
    const { put } = await openJournal(page)

    await strip(page).getByRole('button', { name: 'Mark a moment' }).click()
    const draft = () => strip(page).getByRole('group', { name: /^New moment/ })
    await draft().getByLabel('Clock').fill('4:45')
    await draft().getByLabel('What happened').fill('Should have taken the off-angle.')

    await expect.poll(() => put.seen()).toBe(true)
    expect(put.get().match_clock).toBe('04:45')
    expect(put.get().text).toBe('Should have taken the off-angle.')
  })

  test('shows the moments already on a match, in order', async ({ page }) => {
    await openJournal(page, [
      { moment_id: 'a', match_clock: '03:23', text: 'earlier' },
      { moment_id: 'b', match_clock: '04:45', text: 'later' },
    ])

    await expect(strip(page).getByTestId('moment-clock')).toHaveText(['03:23', '04:45'])
  })

  test('drops one the player takes back', async ({ page }) => {
    const { deletes } = await openJournal(page, [
      { moment_id: 'a', match_clock: '03:23', text: 'earlier' },
    ])

    await strip(page).getByRole('group', { name: /Moment 1 of 1/ })
      .getByRole('button', { name: /remove/i }).click()

    await expect.poll(() => deletes).toEqual(['a'])
  })
})
