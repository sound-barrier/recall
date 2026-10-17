/**
 * Switching profile with screenshots still unparsed.
 *
 * Unparsed screenshots belong to no profile yet: whichever profile parses
 * them next takes them. Switching away while some are pending says so first,
 * with one way forward (switch); closing the menu is how to stay. With
 * nothing pending, the switch goes straight through as before.
 */
import type { Page, Route } from '@playwright/test'

import { routeCapture } from '../_capture'
import { test, expect } from '../_fixtures'

async function bootWith(page: Page, pendingCount: number) {
  const state = { active: 'main', profiles: ['alt', 'main'] }
  const put = routeCapture<{ name?: string }>()
  await page.route('**/api/v1/profiles', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
  })
  await page.route('**/api/v1/profiles/active', async (route: Route) => {
    put.set(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...state, active: 'alt' }) })
  })
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/api/v1/screenshots/pending-count', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ count: pendingCount, parked: 0, claimed_elsewhere: 0 }),
    })
  })
  await page.goto('/')
  await page.locator('.profile-chip').click()
  return put
}

test.describe('profile switch with unparsed screenshots', () => {
  test('pending screenshots: the switch waits behind a notice', async ({ page }) => {
    const put = await bootWith(page, 3)

    await page.locator('.profile-item').nth(0).click()
    const notice = page.locator('.profile-menu')
    await expect(notice).toContainText(/3 screenshots in main's folder aren't parsed yet/)
    await expect(notice).toContainText(/whichever profile parses them next takes them/)
    expect(put.seen()).toBe(false)

    await page.getByRole('button', { name: 'Switch to alt' }).click()
    await expect.poll(() => put.seen()).toBe(true)
    expect(put.get()).toEqual({ name: 'alt' })
  })

  test('nothing pending: the switch goes straight through', async ({ page }) => {
    const put = await bootWith(page, 0)

    await page.locator('.profile-item').nth(0).click()
    await expect.poll(() => put.seen()).toBe(true)
    expect(put.get()).toEqual({ name: 'alt' })
  })
})
