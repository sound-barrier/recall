/**
 * UX-review capture rig — NOT a test. Stages each state of the three review
 * flows (self-review, coach-from-bundle/codes, send/return cycle) and
 * screenshots it across the theme matrix into tmp/ux-shots/, for a visual
 * review pass. Deleted when the review lands; the zz- prefix keeps it at the
 * bottom of the tree and out of anyone's way meanwhile.
 */
import { test, expect } from './_fixtures'
import type { Page, Route } from '@playwright/test'

import {
  COACH_NAME,
  RESURFACED_ITEM_ID,
  RESURFACED_SUMMARY,
  RETURN_SHEET_FIXTURE,
  mockInbox,
  openCoachRoom,
  seedCoachOwnMatches,
} from './_coach'
import { finishedSitting, mockSelfReviews, mockFocus } from './_reviews'
import {
  THEMES,
  pinTheme,
  seedProfiles,
  settleLayout,
  settleView,
  silenceParseEvents,
} from './_theme-matrix'

const SHOT_DIR = '../tmp/ux-shots'

function shot(page: Page, theme: string, name: string) {
  return page.screenshot({ path: `${SHOT_DIR}/${theme}/${name}.png`, fullPage: true })
}

async function baseSeed(page: Page, theme: string): Promise<void> {
  await pinTheme(page, theme)
  await silenceParseEvents(page)
  await seedProfiles(page)
  await seedCoachOwnMatches(page)
}

function record(key: string, map: string, code?: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map, playlist: 'competitive', hero: 'ana', result: 'victory',
      date: '2026-08-18', finished_at: '20:10', eliminations: 20, assists: 4, deaths: 5,
    },
    parsed_at: '2026-08-18T20:15:00Z',
    ...(code === undefined ? {} : { annotation: { replay_code: code } }),
  }
}

async function seedTwoMatches(page: Page): Promise<void> {
  await page.route('**/api/v1/matches', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([
        record('match-2026-08-18T20-10-00', 'dorado', 'A1B2C3'),
        record('match-2026-08-18T21-44-00', 'ilios'),
      ]),
    })
  })
}

for (const theme of THEMES) {
  test.describe(`ux capture — ${theme}`, () => {
    test(`reviews index with sittings + focus (${theme})`, async ({ page }) => {
      await baseSeed(page, theme)
      await mockSelfReviews(page, { reviews: [finishedSitting()] })
      await mockFocus(page, [
        { item_id: RESURFACED_ITEM_ID, text: RESURFACED_SUMMARY, source: 'coach', status: 'new', coach_name: COACH_NAME, from: 'Session with Ordo · Aug 18' },
        { item_id: 'f2f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b', text: 'Stop swinging first on point — count to two.', source: 'self', status: 'working', from: 'Sitting · Aug 20' },
      ])
      await page.goto('/')
      await page.getByRole('tab', { name: /^Reviews/ }).click()
      await settleView(page, 'tab-reviews')
      await settleLayout(page)
      await shot(page, theme, '01-reviews-index')
    })

    test(`reviews index, nothing yet (${theme})`, async ({ page }) => {
      await baseSeed(page, theme)
      await mockSelfReviews(page, { reviews: [] })
      await mockFocus(page, [])
      await page.goto('/')
      await page.getByRole('tab', { name: /^Reviews/ }).click()
      await settleView(page, 'tab-reviews')
      await settleLayout(page)
      await shot(page, theme, '02-reviews-empty')
    })

    test(`self film room over a sitting (${theme})`, async ({ page }) => {
      await baseSeed(page, theme)
      await mockSelfReviews(page, { reviews: [finishedSitting()] })
      await mockFocus(page, [])
      await page.goto('/')
      await page.getByRole('tab', { name: /^Reviews/ }).click()
      await settleView(page, 'tab-reviews')
      await page.getByRole('button', { name: /^Open/ }).first().click()
      await settleLayout(page)
      await shot(page, theme, '03-self-film-room')
    })

    test(`send to a coach dialog (${theme})`, async ({ page }) => {
      await baseSeed(page, theme)
      await seedTwoMatches(page)
      await mockSelfReviews(page, { reviews: [] })
      await mockFocus(page, [])
      await page.goto('/')
      await page.getByRole('tab', { name: /^Reviews/ }).click()
      await settleView(page, 'tab-reviews')
      await page.getByRole('button', { name: /Send to a coach…/ }).click()
      await expect(page.getByRole('dialog', { name: 'Send to a coach' })).toBeVisible()
      await settleLayout(page)
      await shot(page, theme, '04-send-to-coach')
    })

    test(`coach film room, bundle session (${theme})`, async ({ page }) => {
      await openCoachRoom(page, theme)
      await shot(page, theme, '05-coach-film-room')
    })

    test(`coach from replay codes (${theme})`, async ({ page }) => {
      await baseSeed(page, theme)
      await mockSelfReviews(page, { reviews: [] })
      await mockFocus(page, [])
      await page.goto('/')
      await page.getByRole('tab', { name: /^Reviews/ }).click()
      await settleView(page, 'tab-reviews')
      await page.getByRole('button', { name: /Use a replay code/ }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox', { name: 'Replay code' }).fill('A1B2C3')
      await dialog.getByRole('button', { name: 'Add' }).click()
      await dialog.getByRole('textbox', { name: 'Replay code' }).fill('X9Y8Z7')
      await dialog.getByRole('button', { name: 'Add' }).click()
      await settleLayout(page)
      await shot(page, theme, '06-coach-from-codes')
    })

    test(`return inbox + sheet (${theme})`, async ({ page }) => {
      await baseSeed(page, theme)
      await mockSelfReviews(page, { reviews: [] })
      await mockFocus(page, [])
      await mockInbox(page, [RETURN_SHEET_FIXTURE])
      await page.goto('/')
      await settleLayout(page)
      await shot(page, theme, '07-return-inbox-banner')
      await page.getByRole('button', { name: /Read the notes|Read them/ }).click()
      await expect(page.getByRole('dialog', { name: new RegExp(`Notes from ${COACH_NAME}`) })).toBeVisible()
      await settleLayout(page)
      await shot(page, theme, '08-return-sheet')
    })
  })
}
