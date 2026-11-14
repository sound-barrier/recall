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

    await page.getByRole('menuitem', { name: 'Switch to alt' }).click()
    await expect.poll(() => put.seen()).toBe(true)
    expect(put.get()).toEqual({ name: 'alt' })
  })

  test('nothing pending: the switch goes straight through', async ({ page }) => {
    const put = await bootWith(page, 0)

    await page.locator('.profile-item').nth(0).click()
    await expect.poll(() => put.seen()).toBe(true)
    expect(put.get()).toEqual({ name: 'alt' })
  })

  // Picking reads the unparsed count before it switches, and nothing marked
  // the menu busy during that read: a second pick sent a second switch, and
  // the reload cached whichever answered first.
  test('a second pick while the first is still in flight is refused', async ({ page }) => {
    const state = { active: 'main', profiles: ['alt', 'main', 'smurf'] }
    const puts: unknown[] = []
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    // The switch is held on the wire: its reload would otherwise tear the
    // page down before a second switch had the chance to go out.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/api/v1/profiles/active', async (route: Route) => {
      puts.push(JSON.parse(route.request().postData() ?? '{}'))
      await held
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    let slow = false
    await page.route('**/api/v1/screenshots/pending-count', async (route: Route) => {
      if (slow) await new Promise((r) => setTimeout(r, 400))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, parked: 0, claimed_elsewhere: 0 }) })
    })
    await page.goto('/')
    await expect(page.locator('.profile-chip')).toBeVisible()
    slow = true
    await page.locator('.profile-chip').click()

    await page.getByRole('menuitem', { name: 'alt' }).click()
    await page.getByRole('menuitem', { name: 'smurf' }).click({ force: true, timeout: 1000 }).catch(() => {})

    await expect.poll(() => puts.length).toBe(1)
    await page.waitForTimeout(600)
    expect(puts).toEqual([{ name: 'alt' }])
    release()
  })

  // Escape while the count was still loading closed the menu first, and the
  // count then raised the held-switch notice into the closed menu — where
  // the next open showed it for a switch nobody was making any more.
  test('Escape during the count read leaves no held switch behind', async ({ page }) => {
    const state = { active: 'main', profiles: ['alt', 'main'] }
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    let slow = false
    await page.route('**/api/v1/screenshots/pending-count', async (route: Route) => {
      if (slow) await new Promise((r) => setTimeout(r, 400))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 3, parked: 0, claimed_elsewhere: 0 }) })
    })
    await page.goto('/')
    await expect(page.locator('.profile-chip')).toBeVisible()
    slow = true
    await page.locator('.profile-chip').click()
    await page.getByRole('menuitem', { name: 'alt' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.profile-menu')).toHaveCount(0)
    await page.waitForTimeout(600)

    await page.locator('.profile-chip').click()
    await expect(page.locator('.profile-menu')).toBeVisible()
    await expect(page.locator('.profile-switch-notice')).toHaveCount(0)
  })
})
