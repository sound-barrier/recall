/**
 * The bulk bar must not disturb the list it acts on.
 *
 * It used to mount IN FLOW above the rows the moment one was ticked, shoving
 * every row down by its own height — the row under the cursor became a
 * different row and the tick looked like it missed. And its single flex line
 * never wrapped, so at wide windows the tail buttons (Tag, Move to, Clear)
 * spilled past the bar's painted edge. The bar now floats over the viewport
 * bottom: rows keep their exact positions, and every button stays inside.
 */
import { test, expect } from '../_fixtures'
import type { Page } from '@playwright/test'
import { mockSelfReviews } from '../_reviews'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

async function openList(page: Page): Promise<void> {
  await silenceParseEvents(page)
  await seedProfiles(page)
  await mockSelfReviews(page)
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await expect(page.locator('.leaf-row').first()).toBeVisible()
  // Bring the list into the viewport BEFORE measuring, so the click below
  // needs no auto-scroll and the row positions are honest.
  await page.locator('.leaf-row').first().scrollIntoViewIfNeeded()
}

test('ticking a row moves no row — the bar floats instead of inserting', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openList(page)

  const rows = page.locator('.leaf-row')
  const before = await Promise.all([0, 1, 2].map((i) => rows.nth(i).boundingBox()))
  await rows.first().locator('.leaf-checkbox').click()
  await expect(page.getByRole('region', { name: 'Bulk action bar' })).toBeVisible()
  const after = await Promise.all([0, 1, 2].map((i) => rows.nth(i).boundingBox()))

  for (let i = 0; i < 3; i++) {
    expect(Math.abs((after[i]?.y ?? 0) - (before[i]?.y ?? 0)),
      `row ${i} moved when the bar appeared`).toBeLessThanOrEqual(1)
  }
})

for (const width of [1024, 1440, 1920]) {
  test(`every button stays inside the bar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openList(page)
    await page.locator('.leaf-row').first().locator('.leaf-checkbox').click()

    const bar = page.getByRole('region', { name: 'Bulk action bar' })
    await expect(bar).toBeVisible()
    const box = (await bar.boundingBox())!
    const buttons = await bar.getByRole('button').all()
    expect(buttons.length).toBeGreaterThan(5)
    for (const b of buttons) {
      const bb = (await b.boundingBox())!
      expect(bb.x, 'button starts inside the bar').toBeGreaterThanOrEqual(box.x - 1)
      expect(bb.x + bb.width, 'button ends inside the bar').toBeLessThanOrEqual(box.x + box.width + 1)
      expect(bb.y + bb.height, 'button fits vertically').toBeLessThanOrEqual(box.y + box.height + 1)
    }
    // The bar floats at the viewport bottom, over the list.
    expect(box.y + box.height).toBeLessThanOrEqual(800)
    expect(box.y + box.height).toBeGreaterThan(700)
  })
}

test('the dropdown menus open UPWARD, fully inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openList(page)
  await page.locator('.leaf-row').first().locator('.leaf-checkbox').click()

  await page.getByRole('button', { name: 'Set play mode' }).click()
  const item = page.getByRole('menuitem', { name: 'Competitive' })
  await expect(item).toBeVisible()
  const box = (await item.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height, 'menu item below the fold').toBeLessThanOrEqual(800)
  // Upward: the menu sits ABOVE its trigger.
  const trigger = (await page.getByRole('button', { name: 'Set play mode' }).boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(trigger.y + 1)
})
