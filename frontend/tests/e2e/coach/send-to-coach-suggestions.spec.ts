/**
 * Prep suggestions in the send dialog.
 *
 * The dialog opens over whatever the user had already selected, which means
 * the work of choosing happened BEFORE it: scrolling the list, ticking
 * boxes, remembering what went out last time. These two suggestions do the
 * remembering — everything since the last send, and recent losses on what
 * the player is working on — and the set stays editable afterward, because
 * a suggestion the user cannot correct is a decision taken away from them.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

interface MatchSpec {
  key: string
  date: string
  result: string
  hero: string
  code: string
}

const match = (m: MatchSpec) => ({
  match_key: m.key,
  source_files: [`${m.key}.png`],
  source_types: { [`${m.key}.png`]: 'summary' },
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: 'escort', role: 'support',
    hero: m.hero, result: m.result, date: m.date, finished_at: '20:00',
  },
  annotation: { leavers: [], throwers: [], members: [], tags: [], replay_code: m.code },
  parsed_at: `${m.date}T20:00:00Z`,
})

const CORPUS = [
  match({ key: 'm-ana-loss-1', date: '2026-05-01', result: 'defeat', hero: 'ana', code: 'AAA111' }),
  match({ key: 'm-ana-win', date: '2026-05-02', result: 'victory', hero: 'ana', code: 'BBB222' }),
  match({ key: 'm-juno-loss', date: '2026-05-03', result: 'defeat', hero: 'juno', code: 'CCC333' }),
  match({ key: 'm-ana-loss-2', date: '2026-05-04', result: 'defeat', hero: 'ana', code: 'DDD444' }),
]

const FOCUS = [{
  item_id: 'f1',
  text: 'Hold high ground longer on Ana before committing',
  status: 'working',
  source: 'self',
  created_at: '2026-05-01T12:00:00Z',
}]

// One earlier send, so "everything since your last send" has a boundary.
const SHARES = [{
  id: 1, handle: 'Ordo', message: '', exported_at: '2026-05-02T12:00:00Z',
  match_keys: ['m-ana-loss-1', 'm-ana-win'],
}]

const reviewsTab = (page: Page) => page.getByRole('tab', { name: /^Reviews/ })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Send to a coach' })
const rows = (page: Page) =>
  dialog(page).getByRole('list', { name: 'Matches going to your coach' }).getByRole('listitem')

test.describe('send-to-coach prep suggestions', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.route('**/api/v1/focus', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FOCUS) })
    })
    await page.route('**/api/v1/shares', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SHARES) })
    })
    await silenceParseEvents(page)
    await seedProfiles(page)
    await page.setViewportSize({ width: 1500, height: 1000 })
    await page.goto('/')
    await reviewsTab(page).click()
    await page.getByRole('button', { name: /Send to a coach…/ }).click()
    await expect(dialog(page)).toBeVisible()
  })

  test('offers both suggestions and applies one in a click', async ({ page }) => {
    const since = dialog(page).getByRole('button', { name: /everything since your last send/i })
    await expect(since).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: /what you're working on/i })).toBeVisible()

    await since.click()
    // Two matches have gone out already; the other two have not.
    await expect(rows(page)).toHaveCount(2)
  })

  test('the applied set is still the user’s to edit', async ({ page }) => {
    await dialog(page).getByRole('button', { name: /what you're working on/i }).click()
    // Both Ana losses — the win is not what you review, Juno is not the item.
    await expect(rows(page)).toHaveCount(2)

    await dialog(page).getByRole('button', { name: /^Remove /i }).first().click()
    await expect(rows(page)).toHaveCount(1)
  })
})
