/**
 * Multiple-profiles E2E — masthead chip + dropdown + switch/create
 * round-trip.
 *
 * Mocks the four profile-related routes plus /api/v1/matches so the
 * SPA renders deterministically across profile flips. The window
 * reload that the production component triggers is replaced with a
 * spy via `page.addInitScript` so the test can observe the call
 * without losing the wrapper.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

test.describe('masthead profile switcher', () => {
  test('renders the active profile in the chip + lists every profile in the dropdown', async ({ page }) => {
    const state = { active: 'main', profiles: ['alt', 'main'] }
    await page.route('**/api/v1/profiles', async (route: Route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
        return
      }
      await route.fallback()
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await expect(page.locator('.profile-chip')).toContainText('main')
    await expect(page.locator('.profile-menu')).toHaveCount(0)

    await page.locator('.profile-chip').click()
    await expect(page.locator('.profile-menu')).toBeVisible()
    const items = page.locator('.profile-item .profile-item-name')
    await expect(items.nth(0)).toHaveText('alt')
    await expect(items.nth(1)).toHaveText('main')
    await expect(page.locator('.profile-item.active')).toContainText('main')
  })

  test('switching to a different profile fires PUT /profiles/active', async ({ page }) => {
    // The component window.location.reload()'s right after the PUT
    // settles. We accept the navigation (it just reloads / so the
    // page survives) and verify the PUT body was sent.
    const state = { active: 'main', profiles: ['alt', 'main'] }
    let putBody: { name?: string } | null = null
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    await page.route('**/api/v1/profiles/active', async (route: Route) => {
      putBody = JSON.parse(route.request().postData() ?? '{}')
      state.active = putBody?.name ?? state.active
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.locator('.profile-chip').click()
    // Click the non-active "alt" — first item in [alt, main].
    await page.locator('.profile-item').nth(0).click()

    await expect.poll(() => putBody).not.toBeNull()
    expect(putBody).toEqual({ name: 'alt' })
  })

  test('creating a new profile POSTs /profiles', async ({ page }) => {
    const state = { active: 'main', profiles: ['main'] }
    let postBody: { name?: string } | null = null
    await page.route('**/api/v1/profiles', async (route: Route) => {
      const method = route.request().method()
      if (method === 'POST') {
        postBody = JSON.parse(route.request().postData() ?? '{}')
        const name = postBody?.name ?? ''
        state.profiles = [...state.profiles, name].sort()
        state.active = name
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(state) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.locator('.profile-chip').click()
    await page.locator('.profile-new-trigger').click()
    await page.locator('.profile-new-input').fill('smurf')
    await page.locator('.profile-new-confirm').click()

    await expect.poll(() => postBody).not.toBeNull()
    expect(postBody).toEqual({ name: 'smurf' })
  })

  test('typing an invalid profile name disables Create + shows the hint', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: 'main', profiles: ['main'] }) })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.locator('.profile-chip').click()
    await page.locator('.profile-new-trigger').click()
    await page.locator('.profile-new-input').fill('../traversal')

    await expect(page.locator('.profile-new-confirm')).toBeDisabled()
    await expect(page.locator('.profile-new-hint')).toBeVisible()
  })
})
