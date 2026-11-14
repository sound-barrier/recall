/**
 * First-run modal — multi-step shape (item 14).
 *
 * Step 1 still names the main profile. After Save / Keep, the modal
 * now advances to step 2 — an inlined `<ScreenshotSourcePicker>` —
 * instead of dumping the user onto a blank Settings hero. Clicking a
 * found card commits the path via SetScreenshotsDir and dismisses
 * the modal. Back returns to step 1 with the input focused.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const FIRST_RUN_KEY = 'recall.firstRunAccountNamed'

const CANDIDATES_WINDOWS = [
  { name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\Users\\J\\Videos\\Overwatch',                 exists: true  },
  { name: 'prntscn', label: 'OW default',     path: 'C:\\Users\\J\\Documents\\Overwatch\\SS\\Overwatch', exists: false },
  { name: 'snip',    label: 'Snip tool',      path: 'C:\\Users\\J\\Pictures\\Screenshots',             exists: true  },
  { name: 'steam',   label: 'Steam install',  path: '',                                                  exists: false },
]

function tessStatus() {
  return {
    path:      '/opt/homebrew/bin/tesseract',
    found:     true,
    version:   '5.3.4',
    supported: true,
    error:     '',
    platform:  'windows',
  }
}

async function mockBoot(page: import('@playwright/test').Page) {
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
  await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tessStatus()) })
  })
  await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '' }) })
    }
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/v1/system/screenshots-folder-candidates', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CANDIDATES_WINDOWS) })
  })
}

test.describe('first-run modal — multi-step (Save / Keep → picker)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key: string) => {
      try { localStorage.removeItem(key) } catch (_) { /* ignore */ }
    }, FIRST_RUN_KEY)
  })

  test('Keep as "main" advances to the picker step, not dismissal', async ({ page }) => {
    await mockBoot(page)
    await page.goto('/')

    const modal = page.locator('.first-run-modal')
    await expect(modal).toBeVisible()
    await expect(modal.getByTestId('first-run-step-label')).toHaveText('Step 1 of 2')
    await modal.locator('[data-step-keep]').click()

    await expect(modal.getByRole('heading', { level: 2 })).toContainText('Where do your screenshots live?')
    await expect(modal.getByTestId('first-run-step-label')).toHaveText('Step 2 of 2')
    await expect(modal.locator('.src-card')).toHaveCount(4)
    await expect(modal.locator('[data-step-back]')).toBeVisible()
  })

  test('Clicking a found source card commits SetScreenshotsDir + dismisses', async ({ page }) => {
    let putBody: { path?: string } | null = null
    await mockBoot(page)
    await page.unroute('**/api/v1/settings/screenshots-folder')
    await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
      if (route.request().method() === 'PUT') {
        putBody = JSON.parse(route.request().postData() ?? '{}')
        return route.fulfill({ status: 204, body: '' })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '' }) })
    })

    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await modal.locator('[data-step-keep]').click()
    // Click the Nvidia card (first source with exists=true).
    await modal.locator('[data-src-name="nvidia"]').click()

    await expect.poll(() => putBody?.path).toBe('C:\\Users\\J\\Videos\\Overwatch')
    await expect(modal).toHaveCount(0)
    // First-run ack flag persisted.
    const flag = await page.evaluate((key: string) => localStorage.getItem(key), FIRST_RUN_KEY)
    expect(flag).toBe('true')
  })

  test('Back returns from picker to name step with the input focused', async ({ page }) => {
    await mockBoot(page)
    await page.goto('/')

    const modal = page.locator('.first-run-modal')
    // Type a name + Next to advance.
    await modal.locator('.first-run-input').fill('SilentStorm')
    await page.route('**/api/v1/profiles/*', async (route: Route, request) => {
      if (request.method() !== 'PUT') { await route.fallback(); return }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'SilentStorm', profiles: ['SilentStorm'] }),
      })
    })
    await modal.locator('[data-step-save]').click()
    await expect(modal.getByRole('heading', { level: 2 })).toContainText('Where do your screenshots live?')

    // Back returns to step 1; the input shows the typed value still
    // and is focused.
    await modal.locator('[data-step-back]').click()
    await expect(modal.getByRole('heading', { level: 2 })).toContainText('Main account name')
    await expect(modal.locator('.first-run-input')).toBeFocused()
    await expect(modal.locator('.first-run-input')).toHaveValue('SilentStorm')
  })

  test('Skip on the picker step dismisses without setting a folder', async ({ page }) => {
    let putHit = false
    await mockBoot(page)
    await page.unroute('**/api/v1/settings/screenshots-folder')
    await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
      if (route.request().method() === 'PUT') { putHit = true }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '' }) })
    })

    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await modal.locator('[data-step-keep]').click()
    await modal.locator('[data-step-skip]').click()

    await expect(modal).toHaveCount(0)
    expect(putHit).toBe(false)
    // First-run ack flag persisted.
    const flag = await page.evaluate((key: string) => localStorage.getItem(key), FIRST_RUN_KEY)
    expect(flag).toBe('true')
  })

  // "main" is renamed on the server the moment Save lands. The modal forgot
  // that: Back then Save renamed "main" again (gone by then, so it failed),
  // Keep after a rename reported no rename, and the custom-folder path closed
  // without reporting it at all — no reload, storage left scoped to "main".
  async function mockRename(page: import('@playwright/test').Page) {
    const state = { active: 'main', profiles: ['main'] }
    const renames: string[] = []
    await page.unroute('**/api/v1/profiles')
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    await page.route('**/api/v1/profiles/*', async (route: Route, request) => {
      if (request.method() !== 'PUT') { await route.fallback(); return }
      const from = decodeURIComponent(new URL(request.url()).pathname.split('/profiles/')[1] ?? '')
      const to = (JSON.parse(request.postData() ?? '{}') as { new_name?: string }).new_name ?? ''
      renames.push(`${from}->${to}`)
      if (from !== state.active) {
        await route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ title: `profile ${from} not found` }) })
        return
      }
      state.active = to
      state.profiles = [to]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
    })
    return { renames }
  }

  test('Back then Save with the same name renames once and moves on', async ({ page }) => {
    await mockBoot(page)
    const { renames } = await mockRename(page)
    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await modal.locator('.first-run-input').fill('SilentStorm')
    await modal.locator('[data-step-save]').click()
    await expect(modal.getByTestId('first-run-step-label')).toHaveText('Step 2 of 2')
    await modal.locator('[data-step-back]').click()
    await modal.locator('[data-step-save]').click()

    await expect(modal.getByTestId('first-run-step-label')).toHaveText('Step 2 of 2')
    await expect(modal.locator('.first-run-error, [role="alert"]')).toHaveCount(0)
    expect(renames).toEqual(['main->SilentStorm'])
  })

  test('Back then Save with a new name renames the renamed profile', async ({ page }) => {
    await mockBoot(page)
    const { renames } = await mockRename(page)
    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await modal.locator('.first-run-input').fill('SilentStorm')
    await modal.locator('[data-step-save]').click()
    await expect(modal.getByTestId('first-run-step-label')).toHaveText('Step 2 of 2')
    await modal.locator('[data-step-back]').click()
    await modal.locator('.first-run-input').fill('LoudStorm')
    await modal.locator('[data-step-save]').click()

    await expect(modal.getByTestId('first-run-step-label')).toHaveText('Step 2 of 2')
    expect(renames).toEqual(['main->SilentStorm', 'SilentStorm->LoudStorm'])
  })

  test('Keep after a rename still reports the rename', async ({ page }) => {
    await mockBoot(page)
    await mockRename(page)
    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await modal.locator('.first-run-input').fill('SilentStorm')
    await modal.locator('[data-step-save]').click()
    await modal.locator('[data-step-back]').click()
    await modal.locator('[data-step-keep]').click()
    await modal.locator('[data-step-skip]').click()

    await expect(modal).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('recall.activeProfile'))).toBe('SilentStorm')
  })

  test('a rename then a custom folder still moves the storage scope', async ({ page }) => {
    await mockBoot(page)
    await mockRename(page)
    page.on('dialog', (dialog) => { void dialog.accept('/srv/screens') })
    await page.goto('/')
    const modal = page.locator('.first-run-modal')
    await modal.locator('.first-run-input').fill('SilentStorm')
    await modal.locator('[data-step-save]').click()
    await expect(modal.getByTestId('first-run-step-label')).toHaveText('Step 2 of 2')
    await modal.locator('[data-src-pick-custom]').click()

    await expect(modal).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('recall.activeProfile'))).toBe('SilentStorm')
  })
})
