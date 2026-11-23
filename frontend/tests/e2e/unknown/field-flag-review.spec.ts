/**
 * Unknown tab — review a flagged reading beside the pixels it came from.
 *
 * A reading the cross-check flagged stays out of the stats until the player
 * settles it, and the Unknown tab is where that happens. Each flag gets a card
 * holding what the match reads, every reading the checks compared, and a crop
 * of the screenshot region the parse read the field from — cut live from the
 * same /_screenshot/ URL the match already uses, at the rectangle
 * GET /field-regions names. Three ways to settle it:
 *
 *   - Confirm as read — PUT /field-confirmations/{field} with the value the
 *     card SHOWED, so the server can refuse a confirmation of a number a
 *     parse has since replaced (409; the card says it refreshed).
 *   - Edit — the ordinary override write, PUT /matches/{key}/data.
 *   - Pick the other source — the same write, prefilled with the other
 *     reading, so no new storage exists for it.
 *
 * A settled card moves under "N reviewed", and focus moves on with it rather
 * than falling to <body>. A screenshot that is gone says so instead of
 * drawing a broken image.
 */
import type { Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { test, expect } from '../_fixtures'
import { routeCapture } from '../_capture'

const KEY = 'match-2026-06-07T23-00-04'
const FILE = 'ScreenShot_26-06-07_23-00-04-000.jpg'

const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

type FlagState = 'open' | 'confirmed' | 'edited'

interface Served {
  state: FlagState
  value: string
  edited: string[]
}

function record(served: Served) {
  return {
    match_key: KEY,
    source_files: [FILE],
    source_types: { [FILE]: 'summary' },
    source_dir_ids: {},
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio',
      result: 'victory', date: '2026-06-07', finished_at: '23:00',
      eliminations: Number(served.value), assists: 9, deaths: 6, damage: 7200, healing: 9100,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '06:56' }],
    },
    edited_fields: served.edited,
    field_flags: [{
      field: 'data.eliminations',
      value: served.value,
      checks: ['perf_total_vs_rate'],
      state: served.state,
      readings: [
        { source_file: FILE, origin: 'ocr', value: served.value },
        { source_file: FILE, origin: 'derived', value: '9' },
      ],
    }],
    parsed_at: '2026-06-07T23:05:00Z',
  }
}

const REGIONS = {
  regions: [{
    source_file: FILE, dir_id: 0, field: 'data.eliminations',
    x: 412, y: 318, width: 64, height: 36, image_width: 1920, image_height: 1080,
  }],
}

async function serve(page: Page, served: Served, screenshotStatus = 200) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([record(served)]) })
  })
  await page.route(`**/api/v1/matches/${KEY}/field-regions`, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REGIONS) })
  })
  await page.route('**/_screenshot/**', async (route: Route) => {
    if (screenshotStatus === 200) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG })
    } else {
      await route.fulfill({ status: screenshotStatus, contentType: 'text/plain', body: 'not found' })
    }
  })
}

async function openUnknown(page: Page) {
  await page.goto('/')
  await page.getByRole('tab', { name: /^Unknown/ }).click()
  return page.locator('#section-field-flags')
}

const card = (section: ReturnType<Page['locator']>) =>
  section.getByRole('article', { name: /Flagged reading: Eliminations/ })

test.describe('Unknown tab — review flagged readings beside their source crop', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('the card shows the readings beside the crop and passes axe', async ({ page }) => {
    await serve(page, { state: 'open', value: '74', edited: [] })
    const section = await openUnknown(page)

    await expect(section.getByRole('heading', { name: 'Flagged readings — 1' })).toBeVisible()
    const flagged = card(section)
    await expect(flagged).toContainText('74')
    await expect(flagged).toContainText('9')
    await expect(flagged.getByRole('img', { name: `Source crop of Eliminations from ${FILE}` })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .include('#section-field-flags')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })

  test('Confirm sends the shown value and moves the card under reviewed', async ({ page }) => {
    const served: Served = { state: 'open', value: '74', edited: [] }
    await serve(page, served)
    const confirmBody = routeCapture<{ value?: string }>()
    await page.route(`**/api/v1/matches/${KEY}/field-confirmations/data.eliminations`, async (route: Route) => {
      confirmBody.set(JSON.parse(route.request().postData() ?? '{}') as { value?: string })
      served.state = 'confirmed'
      await route.fulfill({ status: 204, body: '' })
    })
    const section = await openUnknown(page)

    await card(section).getByRole('button', { name: /^Confirm as read/ }).click()
    await expect.poll(() => confirmBody.seen()).toBe(true)
    expect(confirmBody.get()).toEqual({ value: '74' })

    await expect(card(section)).toHaveCount(0)
    // The button that held focus left with the card: focus goes on to what is
    // left (here, nothing open, so the heading) and the move is announced.
    await expect(section.getByRole('heading', { name: 'Flagged readings — all reviewed' })).toBeFocused()
    await expect(section.getByRole('status').filter({ hasText: 'Eliminations confirmed — moved to 1 reviewed.' })).toHaveCount(1)
    const disclosure = section.getByRole('button', { name: '1 reviewed — show' })
    await expect(disclosure).toBeVisible()
    await disclosure.click()
    await expect(card(section)).toContainText('Confirmed')
  })

  test('Edit writes the corrected value through the override set', async ({ page }) => {
    const served: Served = { state: 'open', value: '74', edited: [] }
    await serve(page, served)
    const dataBody = routeCapture<Record<string, unknown>>()
    await page.route(`**/api/v1/matches/${KEY}/data`, async (route: Route) => {
      dataBody.set(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>)
      Object.assign(served, { state: 'edited', value: '12', edited: ['data.eliminations'] })
      await route.fulfill({ status: 204, body: '' })
    })
    const section = await openUnknown(page)

    await card(section).getByRole('button', { name: /^Edit/ }).press('Enter')
    await expect(card(section).getByLabel('Corrected Eliminations')).toBeFocused()
    await card(section).getByLabel('Corrected Eliminations').fill('12')
    await card(section).getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => dataBody.seen()).toBe(true)
    expect(dataBody.get()).toMatchObject({ eliminations: 12 })
    await expect(section.getByRole('button', { name: '1 reviewed — show' })).toBeVisible()
  })

  test('picking the other source writes that reading', async ({ page }) => {
    const served: Served = { state: 'open', value: '74', edited: [] }
    await serve(page, served)
    const dataBody = routeCapture<Record<string, unknown>>()
    await page.route(`**/api/v1/matches/${KEY}/data`, async (route: Route) => {
      dataBody.set(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>)
      Object.assign(served, { state: 'edited', value: '9', edited: ['data.eliminations'] })
      await route.fulfill({ status: 204, body: '' })
    })
    const section = await openUnknown(page)

    await card(section).getByRole('button', { name: /^Use 9/ }).click()

    await expect.poll(() => dataBody.seen()).toBe(true)
    expect(dataBody.get()).toMatchObject({ eliminations: 9 })
    await expect(section.getByRole('button', { name: '1 reviewed — show' })).toBeVisible()
  })

  test('a screenshot that is gone reads as source missing', async ({ page }) => {
    await serve(page, { state: 'open', value: '74', edited: [] }, 404)
    const section = await openUnknown(page)

    await expect(card(section)).toContainText('Source missing')
    await expect(card(section).getByRole('img', { name: /Source crop of/ })).toHaveCount(0)
  })

  test('a reading a parse changed is refused and the card says it refreshed', async ({ page }) => {
    const served: Served = { state: 'open', value: '74', edited: [] }
    await serve(page, served)
    await page.route(`**/api/v1/matches/${KEY}/field-confirmations/data.eliminations`, async (route: Route) => {
      served.value = '75'
      await route.fulfill({
        status: 409, contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://github.com/sound-barrier/recall/problems/conflict',
          title: 'Conflict', status: 409,
          detail: `the flagged reading changed since it was shown: data.eliminations on ${KEY} reads "75", not "74"`,
        }),
      })
    })
    const section = await openUnknown(page)

    await card(section).getByRole('button', { name: /^Confirm as read/ }).click()

    await expect(card(section).getByRole('status')).toContainText('This reading changed since you looked')
    await expect(card(section)).toContainText('75')
  })

  test("the dossier's notice lands on the flagged readings", async ({ page }) => {
    await serve(page, { state: 'open', value: '74', edited: [] })
    await page.goto('/')

    await page.getByRole('button', { name: 'Review flagged readings' }).click()

    await expect(page.getByRole('heading', { name: 'Flagged readings — 1' })).toBeFocused()
  })
})
