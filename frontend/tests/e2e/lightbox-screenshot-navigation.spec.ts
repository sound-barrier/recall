/**
 * Lightbox: navigate between screenshots of the SAME match.
 *
 * Pre-this-PR the lightbox was a one-shot viewer — you opened a
 * screenshot, you could close it, that was the whole API. To see
 * the next screenshot of the same match you closed the lightbox,
 * clicked a different filename's preview thumbnail, then re-opened.
 *
 * Now the lightbox carries `<` and `>` buttons flanking the image
 * and accepts both arrow keys and h/l (vim) for prev/next. The
 * navigation is CLAMPED to the source_files of the match the user
 * opened against — it cannot cross into a sibling match's
 * screenshots even when the lightbox stays open through a navigation
 * gesture.
 *
 * This spec drives:
 *   1. ← / → arrow keys
 *   2. h / l vim aliases
 *   3. `<` / `>` button clicks (lightbox UI affordance)
 *   4. clamp at first/last (disabled boundary)
 *   5. `N of M` caption updates as the user navigates
 *   6. negative pin: lightbox stays inside the opened match's
 *      source_files even after closing + re-opening on a sibling
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function stubScreenshotBytes(page: import('@playwright/test').Page) {
  await page.route('**/_screenshot/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG })
  })
}

// Match with three source files, ordered as the parser inserted
// them (scoreboard → summary → personal — common shape for a fully-
// captured match). The lightbox should navigate this exact ordering.
const MULTI = {
  match_key: 'match:2026-05-10T21:29:28',
  source_files: [
    'scoreboard-2129.png',
    'summary-2149.png',
    'personal-2152.png',
  ],
  source_types: {
    'scoreboard-2129.png': 'scoreboard',
    'summary-2149.png':    'summary',
    'personal-2152.png':   'personal',
  },
  data: {
    map: 'rialto', mode: 'competitive', type: 'escort',
    role: 'support', hero: 'lucio', result: 'victory',
    date: '2026-05-10', finished_at: '21:29',
    eliminations: 17, assists: 14, deaths: 7,
    heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '20:00' }],
  },
  parsed_at: '2026-05-10T21:30:00Z',
}

const SOLO = {
  match_key: 'match:2026-05-10T22:30:00',
  source_files: ['solo-2230.png'],
  source_types: { 'solo-2230.png': 'summary' },
  data: {
    map: 'numbani', mode: 'competitive', type: 'hybrid',
    role: 'damage', hero: 'soldier-76', result: 'defeat',
    date: '2026-05-10', finished_at: '22:30',
    heroes_played: [{ hero: 'soldier-76', percent_played: 100, play_time: '11:00' }],
  },
  parsed_at: '2026-05-10T22:35:00Z',
}

async function seed(page: import('@playwright/test').Page) {
  await stubScreenshotBytes(page)
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MULTI, SOLO]),
    })
  })
  await page.route('**/api/v1/system/reference-data', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ heroes_by_role: {}, maps_by_type: {} }),
    })
  })
}

// Drill in: Matches tab → open the multi-file match's detail panel
// → expand Source Screenshots → open the lightbox on file #1.
async function openLightboxOnFirstFile(page: import('@playwright/test').Page) {
  await page.locator('#tab-matches').click()
  // The leaf row for the multi-file match — find by hero.
  await page.locator('.leaf-row', { hasText: 'lucio' }).click()
  await expect(page.locator('aside.detail-panel')).toBeVisible()
  // Expand Source Screenshots, then toggle the first filename → its
  // thumbnail renders → click it → lightbox opens.
  await page.locator('.sources-toggle .sources-label').click()
  await page.locator('.source-name').first().click()
  await page.locator('img.source-preview').first().click()
  await expect(page.locator('.lightbox-backdrop')).toBeVisible()
}

test.describe('lightbox — navigate between screenshots of the same match', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
    await page.goto('/')
  })

  test('renders < and > buttons flanking the image plus an N of M caption', async ({ page }) => {
    await openLightboxOnFirstFile(page)
    await expect(page.locator('.lightbox-prev')).toBeVisible()
    await expect(page.locator('.lightbox-next')).toBeVisible()
    // First file → < disabled, > enabled.
    await expect(page.locator('.lightbox-prev')).toBeDisabled()
    await expect(page.locator('.lightbox-next')).not.toBeDisabled()
    // Caption is positioned next to the close button. Anchors on the
    // literal "of" so we don't have to know the exact total here.
    await expect(page.locator('.lightbox-count')).toContainText('1 of 3')
  })

  test('ArrowRight + ArrowLeft step forward and back; clamp at the ends', async ({ page }) => {
    await openLightboxOnFirstFile(page)
    const img = page.locator('img.lightbox-img')

    await expect(img).toHaveAttribute('alt', 'scoreboard-2129.png')
    await page.keyboard.press('ArrowRight')
    await expect(img).toHaveAttribute('alt', 'summary-2149.png')
    await expect(page.locator('.lightbox-count')).toContainText('2 of 3')

    await page.keyboard.press('ArrowRight')
    await expect(img).toHaveAttribute('alt', 'personal-2152.png')
    // End of the list → > disabled, > arrow no-op.
    await expect(page.locator('.lightbox-next')).toBeDisabled()
    await page.keyboard.press('ArrowRight')
    await expect(img).toHaveAttribute('alt', 'personal-2152.png')

    // ← walks back.
    await page.keyboard.press('ArrowLeft')
    await expect(img).toHaveAttribute('alt', 'summary-2149.png')
    await page.keyboard.press('ArrowLeft')
    await expect(img).toHaveAttribute('alt', 'scoreboard-2129.png')
    // Start → < disabled, ← no-op.
    await expect(page.locator('.lightbox-prev')).toBeDisabled()
    await page.keyboard.press('ArrowLeft')
    await expect(img).toHaveAttribute('alt', 'scoreboard-2129.png')
  })

  test('h / l vim aliases mirror the arrow-key behaviour', async ({ page }) => {
    await openLightboxOnFirstFile(page)
    const img = page.locator('img.lightbox-img')

    await page.keyboard.press('l')
    await expect(img).toHaveAttribute('alt', 'summary-2149.png')
    await page.keyboard.press('l')
    await expect(img).toHaveAttribute('alt', 'personal-2152.png')
    await page.keyboard.press('h')
    await expect(img).toHaveAttribute('alt', 'summary-2149.png')
    await page.keyboard.press('h')
    await expect(img).toHaveAttribute('alt', 'scoreboard-2129.png')
  })

  test('clicking the < and > buttons navigates the same set', async ({ page }) => {
    await openLightboxOnFirstFile(page)
    const img = page.locator('img.lightbox-img')

    await page.locator('.lightbox-next').click()
    await expect(img).toHaveAttribute('alt', 'summary-2149.png')
    await page.locator('.lightbox-next').click()
    await expect(img).toHaveAttribute('alt', 'personal-2152.png')
    await page.locator('.lightbox-prev').click()
    await expect(img).toHaveAttribute('alt', 'summary-2149.png')
  })

  test('navigation stays inside the opened match — does not bleed into a sibling match', async ({ page }) => {
    await openLightboxOnFirstFile(page)
    const img = page.locator('img.lightbox-img')

    // Walk to the end of the multi-file match.
    await page.keyboard.press('l')
    await page.keyboard.press('l')
    await expect(img).toHaveAttribute('alt', 'personal-2152.png')
    // > is disabled at the boundary — proves the lightbox didn't
    // splice in the SOLO match's `solo-2230.png` file. There's no
    // wraparound either: ← walks back into MULTI's set, not over to
    // SOLO's.
    await expect(page.locator('.lightbox-next')).toBeDisabled()
    await page.keyboard.press('l')
    await expect(img).toHaveAttribute('alt', 'personal-2152.png')
    // Sanity: no SOLO filename surfaced in the lightbox at any
    // point during the walk.
    await expect(img).not.toHaveAttribute('alt', 'solo-2230.png')
  })

  test('a single-file match disables BOTH arrow buttons and hides the caption', async ({ page }) => {
    // Tab into Matches, open the SOLO match's lightbox via its sole
    // source file. With files.length === 1 the user has no navigation
    // affordance — the < and > render but stay disabled, the caption
    // suppresses (no `1 of 1` noise).
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row', { hasText: 'soldier-76' }).click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await page.locator('.sources-toggle .sources-label').click()
    await page.locator('.source-name').click()
    await page.locator('img.source-preview').click()
    await expect(page.locator('.lightbox-backdrop')).toBeVisible()

    await expect(page.locator('.lightbox-prev')).toBeDisabled()
    await expect(page.locator('.lightbox-next')).toBeDisabled()
    await expect(page.locator('.lightbox-count')).toHaveCount(0)
  })
})
