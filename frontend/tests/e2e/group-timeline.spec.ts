/**
 * Group-timeline jump-rail E2E.
 *
 * The MatchesView surfaces a right-edge vertical timeline rail with
 * one chip per month group when 2+ months are present. Clicking a
 * chip:
 *
 *   1. auto-expands the target group if it's collapsed (so the user
 *      lands at content, not at a closed chevron),
 *   2. smooth-scrolls the group's section into view,
 *   3. flips aria-current on the rail to reflect the new in-view
 *      month.
 *
 * A single-month corpus suppresses the rail entirely — nothing to
 * jump between.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(matchKey: string, date: string) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date,
      finished_at: '22:00',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: `${date}T22:30:00Z`,
  }
}

// Three months of records: May, April, March 2026. Plenty of distance
// between groups so the smooth-scroll has somewhere to go.
const THREE_MONTHS = [
  record('m:1', '2026-05-10'),
  record('m:2', '2026-05-04'),
  record('m:3', '2026-04-20'),
  record('m:4', '2026-04-12'),
  record('m:5', '2026-03-15'),
  record('m:6', '2026-03-02'),
]

test.describe('group timeline — jump rail', () => {
  test('renders one chip per month group with match count', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(THREE_MONTHS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.match')).toHaveCount(6)

    const rail = page.locator('nav[aria-label="Match timeline"]')
    await expect(rail).toBeVisible()
    const chips = rail.locator('button.timeline-chip')
    await expect(chips).toHaveCount(3)
    // Sorted newest-first (matches the default match-list sort).
    await expect(chips.nth(0)).toContainText(/May/i)
    await expect(chips.nth(1)).toContainText(/Apr/i)
    await expect(chips.nth(2)).toContainText(/Mar/i)
  })

  test('suppresses the rail when only one month is present', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('m:1', '2026-05-10'),
          record('m:2', '2026-05-04'),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.match')).toHaveCount(2)
    await expect(page.locator('nav[aria-label="Match timeline"]')).toHaveCount(0)
  })

  test('clicking a chip scrolls the target month into view + expands it', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(THREE_MONTHS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.match')).toHaveCount(6)

    // The default expansion (useMatchGrouping firstPathKeys) opens the
    // newest path only — May 2026 + week + day. April + March stay
    // collapsed. Click the April chip.
    const aprChip = page.locator('button.timeline-chip', { hasText: /Apr/i })
    await aprChip.click()

    // Target section is the month-level group keyed by '2026-04'. After
    // the click it must be expanded (aria-expanded=true on the head
    // button) AND the page must have scrolled towards it.
    const aprSection = page.locator('section.mg-level-month[data-key="month:2026-04"]')
    await expect(aprSection).toBeVisible()
    await expect(aprSection.locator('.mg-head').first()).toHaveAttribute('aria-expanded', 'true')

    // `scrollIntoView({block: 'start'})` clamps when the doc isn't tall
    // enough to put the target at viewport top — so the literal
    // bounding-box position isn't a reliable assertion. Instead, verify
    // (a) the page scrolled (scrollY moved off 0), and (b) the section
    // is in the viewport's lower half or above (i.e. visible without
    // further scrolling).
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await expect.poll(async () => {
      const box = await aprSection.boundingBox()
      const vh = await page.evaluate(() => window.innerHeight)
      if (!box) return -1
      return box.y < vh ? 1 : 0
    }).toBe(1)
  })

  test('rail marks the in-view month with aria-current', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(THREE_MONTHS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Jump to March, then assert the March chip carries aria-current.
    await page.locator('button.timeline-chip', { hasText: /Mar/i }).click()
    await expect.poll(async () => {
      return page.locator('button.timeline-chip', { hasText: /Mar/i }).getAttribute('aria-current')
    }).toBe('location')
  })
})
