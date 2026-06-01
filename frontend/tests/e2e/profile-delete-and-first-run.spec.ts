/**
 * Profile management:
 *   - First-run modal asks for the Main account name BEFORE the user
 *     can change any other setting. Dismissable two ways:
 *       1. Type a name + Save → renames the default `main` profile.
 *       2. "Keep as main" → records the acknowledgement so the modal
 *          doesn't reappear on next launch.
 *     ESC / backdrop click intentionally do NOT close it — it's a
 *     forced gate, not a soft prompt.
 *
 *   - Settings page exposes a Profiles section listing every profile.
 *     The active profile has no delete affordance; non-active profiles
 *     get a Delete button with a two-step inline confirm. Confirm
 *     fires DELETE /api/v1/profiles/{name}; the row disappears.
 *
 * The acknowledgement flag is localStorage `recall.firstRunAccountNamed`.
 * The fixture preset (which already pre-dismisses the onboarding tour)
 * pre-sets this flag for every test that does NOT specifically exercise
 * the first-run flow. The first-run-specific tests clear the flag in an
 * addInitScript before navigation.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const FIRST_RUN_KEY = 'recall.firstRunAccountNamed'

// Pre-set the acknowledgement flag for every test in this file. The
// individual first-run-flow tests below clear it via addInitScript.
test.beforeEach(async ({ page }) => {
  await page.addInitScript((key: string) => {
    try { localStorage.setItem(key, 'true') } catch (_) { /* ignore */ }
  }, FIRST_RUN_KEY)
})

test.describe('settings — Profiles section delete affordance', () => {
  test('lists every profile; only non-active rows offer a Delete button', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['alt', 'main'] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // Profiles section is present.
    const section = page.locator('#sec-profiles')
    await expect(section).toBeVisible()

    // Each profile rendered as a row.
    const rows = section.locator('.profile-mgmt-row')
    await expect(rows).toHaveCount(2)

    // Active row carries the marker and has no delete button.
    const activeRow = section.locator('.profile-mgmt-row.active')
    await expect(activeRow).toContainText('main')
    await expect(activeRow.locator('.profile-mgmt-delete')).toHaveCount(0)

    // Non-active row exposes Delete.
    const altRow = rows.filter({ hasText: 'alt' })
    await expect(altRow.locator('.profile-mgmt-delete')).toBeVisible()
  })

  test('Delete → Confirm fires DELETE /api/v1/profiles/{name} and removes the row', async ({ page }) => {
    let getCount = 0
    let deletedName: string | null = null
    let deleteCount = 0
    const state = { active: 'main', profiles: ['alt', 'main'] }
    await page.route('**/api/v1/profiles', async (route: Route) => {
      getCount++
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    await page.route('**/api/v1/profiles/*', async (route: Route, request) => {
      if (request.method() !== 'DELETE') {
        await route.fallback()
        return
      }
      const segs = new URL(request.url()).pathname.split('/')
      deletedName = decodeURIComponent(segs[segs.length - 1] ?? '')
      state.profiles = state.profiles.filter((p) => p !== deletedName)
      deleteCount++
      await route.fulfill({ status: 204, body: '' })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()

    const altRow = page.locator('.profile-mgmt-row').filter({ hasText: 'alt' })
    await altRow.locator('.profile-mgmt-delete').click()

    // Two-step affordance — Confirm + Cancel surface.
    await expect(altRow.locator('.profile-mgmt-delete-confirm')).toBeVisible()
    await expect(altRow.locator('.profile-mgmt-delete-cancel')).toBeVisible()

    await altRow.locator('.profile-mgmt-delete-confirm').click()

    await expect.poll(() => deleteCount).toBeGreaterThanOrEqual(1)
    expect(deletedName).toBe('alt')
    // Refresh fires after the DELETE round-trip; the row is gone.
    await expect.poll(() => getCount).toBeGreaterThanOrEqual(2)
    await expect(page.locator('.profile-mgmt-row')).toHaveCount(1)
  })

  test('Cancel aborts the delete without firing DELETE', async ({ page }) => {
    let deleteCount = 0
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['alt', 'main'] }),
      })
    })
    await page.route('**/api/v1/profiles/*', async (route: Route, request) => {
      if (request.method() === 'DELETE') deleteCount++
      await route.fulfill({ status: 204, body: '' })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    const altRow = page.locator('.profile-mgmt-row').filter({ hasText: 'alt' })
    await altRow.locator('.profile-mgmt-delete').click()
    await altRow.locator('.profile-mgmt-delete-cancel').click()

    // Confirm is gone, Delete is back, no DELETE fired.
    await expect(altRow.locator('.profile-mgmt-delete')).toBeVisible()
    await expect(altRow.locator('.profile-mgmt-delete-confirm')).toHaveCount(0)
    expect(deleteCount).toBe(0)
  })
})

test.describe('first-run profile-name modal', () => {
  test.beforeEach(async ({ page }) => {
    // Clear the acknowledgement so the modal surfaces. Runs AFTER the
    // outer beforeEach's set — addInitScripts execute in registration
    // order on every navigation.
    await page.addInitScript((key: string) => {
      try { localStorage.removeItem(key) } catch (_) { /* ignore */ }
    }, FIRST_RUN_KEY)
  })

  test('renders on first launch and gates the background with inert', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')

    const modal = page.locator('.first-run-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('h2')).toContainText('Main account name')

    // Background container is inert + aria-hidden while the modal is up.
    await expect(page.locator('.container').first()).toHaveAttribute('aria-hidden', 'true')
  })

  test('Save renames the main profile via PUT /api/v1/profiles/main and dismisses the modal', async ({ page }) => {
    let putBody: { new_name?: string } | null = null
    let renamedTarget: string | null = null
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/profiles/*', async (route: Route, request) => {
      if (request.method() !== 'PUT') { await route.fallback(); return }
      const segs = new URL(request.url()).pathname.split('/')
      renamedTarget = decodeURIComponent(segs[segs.length - 1] ?? '')
      putBody = JSON.parse(request.postData() ?? '{}')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: putBody?.new_name, profiles: [putBody?.new_name] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await expect(modal).toBeVisible()

    await modal.locator('.first-run-input').fill('SilentStorm')
    await modal.locator('.first-run-save').click()

    await expect.poll(() => putBody).not.toBeNull()
    expect(renamedTarget).toBe('main')
    expect(putBody).toEqual({ new_name: 'SilentStorm' })
  })

  test('Save reloads so the masthead chip immediately reflects the new name', async ({ page }) => {
    // Regression: typing a custom name and clicking Save originally
    // emitted dismiss + called load() only, which refetches matches
    // but leaves the ProfileSwitcher chip stuck on its initial
    // GetProfiles() snapshot ('main'). Fix is to mirror the chip's
    // own switch/create/rename flow and reload after the rename.
    const state = { active: 'main', profiles: ['main'] }
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    await page.route('**/api/v1/profiles/*', async (route: Route, request) => {
      if (request.method() !== 'PUT') { await route.fallback(); return }
      const body = JSON.parse(request.postData() ?? '{}') as { new_name?: string }
      const next = body.new_name ?? state.active
      state.active = next
      state.profiles = [next]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await expect(modal).toBeVisible()
    // Chip starts on the default `main` profile.
    await expect(page.locator('.profile-chip')).toContainText('main')

    await modal.locator('.first-run-input').fill('dpsmoira')
    await modal.locator('.first-run-save').click()

    // After the post-save reload the chip re-fetches GetProfiles and
    // surfaces the renamed active. The file-level beforeEach clears
    // the ack flag on every navigation so the modal briefly returns
    // post-reload — but the chip text still updates regardless.
    await expect(page.locator('.profile-chip')).toContainText('dpsmoira', { timeout: 8000 })
  })

  test('Keep as "main" records the acknowledgement so the modal does not return', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await expect(modal).toBeVisible()
    await modal.locator('.first-run-keep').click()
    await expect(modal).toHaveCount(0)

    // Flag persisted.
    const flag = await page.evaluate((key: string) => localStorage.getItem(key), FIRST_RUN_KEY)
    expect(flag).toBe('true')
  })

  test('ESC does NOT dismiss the modal — it is a forced gate', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await expect(modal).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(modal).toBeVisible()
  })

  test('invalid profile name disables Save + shows the hint', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await expect(modal).toBeVisible()
    await modal.locator('.first-run-input').fill('../path-traversal')
    await expect(modal.locator('.first-run-save')).toBeDisabled()
    await expect(modal.locator('.first-run-hint')).toBeVisible()
  })
})

test.describe('first-run modal — onboarding-tour interaction', () => {
  // On a TRUE first launch both `recall.onboardingCompleted` and
  // `recall.firstRunAccountNamed` are unset. Without coordination
  // the modal stacks on top of the tour and the two overlays trap
  // each other's focus. The modal should yield to the tour and
  // surface only after the tour is dismissed.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('recall.firstRunAccountNamed')
        localStorage.removeItem('recall.onboardingCompleted')
      } catch (_) { /* ignore */ }
    })
  })

  test('does NOT render while the onboarding tour is active', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeVisible()
    // Modal stays out of the DOM while the tour drives the page.
    await expect(page.locator('.first-run-modal')).toHaveCount(0)
  })

  test('surfaces after the tour is skipped', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    const tour = page.locator('[data-testid="onboarding-tour"]')
    await expect(tour).toBeVisible()
    // Skip the tour.
    await tour.getByRole('button', { name: /skip/i }).click()
    await expect(tour).toBeHidden()
    // Now the modal can surface (account flag is still unset).
    await expect(page.locator('.first-run-modal')).toBeVisible()
  })
})
