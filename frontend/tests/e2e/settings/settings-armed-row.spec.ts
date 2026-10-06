/**
 * Settings → Advanced — arming a destructive row (re-parse all, clear
 * database, restore) must SHOW that it is armed, on every theme, and must
 * not shove the row's content sideways while the user is reading it.
 *
 * The armed treatment once lived in SettingsView's scoped block while the
 * rows themselves render inside child section components, which scoped CSS
 * cannot reach: the armed row looked identical to an idle one on every
 * theme but Day, whose global override was the only rule that landed.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const THEMES = ['night', 'day'] as const

for (const theme of THEMES) {
  test(`an armed destructive row is visibly marked and does not shift (${theme})`, async ({ page }) => {
    await page.addInitScript(t => localStorage.setItem('recall.theme', t), theme)
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          path: '/usr/bin/tesseract', found: true, version: '5.3.4',
          supported: true, error: '', platform: 'linux',
        }),
      })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.locator('#sec-advanced').evaluate(el => (el as HTMLDetailsElement).open = true)

    const label = page.getByRole('heading', { name: /Re-parse All Screenshots/ })
    const row = page.locator('.setting-row', { has: label })
    // A sibling destructive row that stays idle: the reference the armed
    // row must stand out from, read at the same moment so a transition or
    // a stray :hover can't fake the difference.
    const idleSibling = page.locator('.setting-row', {
      has: page.getByRole('heading', { name: /Clear Parse Database/ }),
    })
    await expect(label).toBeVisible()
    const idleLabelX = (await label.boundingBox())!.x

    await page.locator('[data-reparse-all-arm]').click()
    await expect(page.locator('[data-reparse-all-confirm]')).toBeVisible()
    await page.mouse.move(0, 0)

    // Read only once every transition on the row has finished: a sample
    // taken mid-fade differs from its idle sibling whether or not the
    // armed treatment exists.
    await row.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
    const background = (loc: typeof row) => loc.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(await background(row)).not.toBe(await background(idleSibling))
    await expect.poll(async () => (await label.boundingBox())!.x).toBe(idleLabelX)
  })
}
