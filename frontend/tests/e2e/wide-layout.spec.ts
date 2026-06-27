/**
 * Wide-window layout.
 *
 * The page container (.container, which wraps the masthead + every view) grows
 * from the 1140 floor toward a ~1600 ceiling as the window is enlarged, so the
 * data-dense views use the space instead of stranding a narrow column in empty
 * gutters. Text-heavy views (Settings, Parse) cap their own content back to a
 * readable measure. The default-size window must look exactly as before.
 *
 * No api mocking — the container + panels render with empty data.
 */
import { test, expect } from './_fixtures'

async function widthOf(page: import('@playwright/test').Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox()
  return box?.width ?? 0
}

test.describe('wide-window layout', () => {
  test('the content container grows toward the ceiling on a wide window', async ({ page }) => {
    await page.setViewportSize({ width: 2000, height: 1200 })
    await page.goto('/')
    // Matches is the default landing view; the container fills toward 1600.
    const container = await widthOf(page, '.container')
    expect(container).toBeGreaterThan(1400)
    expect(container).toBeLessThanOrEqual(1620)
  })

  test('the text-heavy Settings view stays capped at a readable measure', async ({ page }) => {
    await page.setViewportSize({ width: 2000, height: 1200 })
    await page.goto('/')
    await page.locator('#tab-settings').click()
    await expect(page.locator('#panel-settings')).toBeVisible()

    const panel = await widthOf(page, '#panel-settings')
    const container = await widthOf(page, '.container')
    // ~1180 cap — comfortably narrower than the wide container around it.
    expect(panel).toBeLessThanOrEqual(1240)
    expect(container - panel).toBeGreaterThan(200)
  })

  test('the default-size window keeps the ~1140 floor (no regression)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const container = await widthOf(page, '.container')
    expect(container).toBeGreaterThanOrEqual(1100)
    expect(container).toBeLessThanOrEqual(1200)
  })
})
