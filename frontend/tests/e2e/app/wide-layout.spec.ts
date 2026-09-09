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
import { test, expect } from '../_fixtures'

async function widthOf(target: import('@playwright/test').Locator): Promise<number> {
  const box = await target.first().boundingBox()
  return box?.width ?? 0
}

test.describe('wide-window layout', () => {
  test('the content container grows past 1140 on a maximized 1080p window', async ({ page }) => {
    // 1080p (the most common display) maximized — set by the clamp slope, not
    // the ceiling: ~1532, comfortably past the 1140 floor.
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/')
    const container = await widthOf(page.locator('.container'))
    expect(container).toBeGreaterThan(1450)
    expect(container).toBeLessThan(1600)
  })

  test('a 1440p-class window reaches the wider ceiling (not stranded at 1600)', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.goto('/')
    const container = await widthOf(page.locator('.container'))
    expect(container).toBeGreaterThanOrEqual(1700)
    expect(container).toBeLessThanOrEqual(1780)
  })

  test('the text-heavy Settings view stays capped at a readable measure', async ({ page }) => {
    await page.setViewportSize({ width: 2000, height: 1200 })
    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible()

    const panel = await widthOf(page.getByRole('tabpanel', { name: 'Settings' }))
    const container = await widthOf(page.locator('.container'))
    // ~1180 cap — comfortably narrower than the wide container around it.
    expect(panel).toBeLessThanOrEqual(1240)
    expect(container - panel).toBeGreaterThan(200)
  })

  // The two cases below are the sizes the app ACTUALLY opens at now: 80% of
  // the monitor's work area. They used to read 1440x900, which was 75% of
  // 1080p — a size the window has not opened at since the v3 port silently
  // broke the sizing, and never will again.
  test('a default-size window on 1080p clears the floor', async ({ page }) => {
    // 80% of a 1920x1032 work area.
    await page.setViewportSize({ width: 1536, height: 826 })
    await page.goto('/')
    const container = await widthOf(page.locator('.container'))
    expect(container).toBeGreaterThanOrEqual(1140)
    expect(container).toBeLessThanOrEqual(1260)
  })

  test('a default-size window on 1440p uses the extra width', async ({ page }) => {
    // 80% of a 2560x1392 work area — the case that started this: the window
    // must not look like the small one any more.
    await page.setViewportSize({ width: 2048, height: 1114 })
    await page.goto('/')
    const container = await widthOf(page.locator('.container'))
    expect(container).toBeGreaterThanOrEqual(1580)
    expect(container).toBeLessThanOrEqual(1700)
  })
})
