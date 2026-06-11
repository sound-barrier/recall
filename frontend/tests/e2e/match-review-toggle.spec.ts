/**
 * Per-match review-status toggle in the detail-panel sidebar.
 *
 * The toggle is the FIRST thing inside the panel body — above the
 * meta strip, leaver chooser, stats. Three mutually exclusive states:
 *
 *   ⬡  Not reviewed  (default; absent reviewed_by)
 *   ◐  Self-reviewed (user reviewed the VOD themselves)
 *   ★  Coach-reviewed (a coach reviewed the VOD with the user)
 *
 * REST shape: `PUT /api/v1/matches/{matchKey}/review {reviewed_by}`
 * to set; `DELETE` to clear. Both 204.
 *
 * Mirrors the leaver-chooser pattern (radiogroup, aria-pressed),
 * extended with the panel-top "first thing" placement contract.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function record(matchKey: string, reviewedBy: '' | 'self' | 'coach' = '') {
  const rec: Record<string, unknown> = {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11, damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
      final_score: '3-2',
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
  if (reviewedBy) rec.reviewed_by = reviewedBy
  return rec
}

test.describe('match review-status toggle — panel sidebar', () => {
  test('sits at the very top of the detail panel body', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1')]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // The review chooser exists.
    const chooser = page.locator('.review-chooser')
    await expect(chooser).toBeVisible()

    // …and it's the first major section in the panel body.
    const firstSectionClass = await page.evaluate(() => {
      const body = document.querySelector('.detail-body')
      if (!body) return null
      const known = ['review-chooser', 'detail-meta-strip', 'leaver-chooser', 'stats']
      const walker = body.querySelectorAll('*')
      for (const el of Array.from(walker)) {
        for (const cls of known) {
          if (el.classList.contains(cls)) return cls
        }
      }
      return null
    })
    expect(firstSectionClass).toBe('review-chooser')
  })

  test('starts in the "not reviewed" state when reviewed_by is absent', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1')]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await expect(
      page.locator('.review-chip[data-state="none"]'),
    ).toHaveAttribute('aria-checked', 'true')
    await expect(
      page.locator('.review-chip[data-state="self"]'),
    ).toHaveAttribute('aria-checked', 'false')
    await expect(
      page.locator('.review-chip[data-state="coach"]'),
    ).toHaveAttribute('aria-checked', 'false')
  })

  test('clicking "self" PUTs reviewed_by=self and the chip flips active', async ({ page }) => {
    let reviewedBy: '' | 'self' | 'coach' = ''
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1', reviewedBy)]),
      })
    })
    let lastPutBody: string | null = null
    await page.route('**/api/v1/matches/m1/review', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'PUT') {
        lastPutBody = req.postData()
        const body = JSON.parse(lastPutBody ?? '{}') as { reviewed_by?: string }
        reviewedBy = (body.reviewed_by ?? '') as '' | 'self' | 'coach'
        await route.fulfill({ status: 204, body: '' })
      } else if (req.method() === 'DELETE') {
        reviewedBy = ''
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await page.locator('.review-chip[data-state="self"]').click()

    // PUT round-trip happened with the right body shape.
    await expect.poll(() => lastPutBody).not.toBeNull()
    expect(JSON.parse(lastPutBody!)).toEqual({ reviewed_by: 'self' })

    // After the reload, the self chip is selected.
    await expect(
      page.locator('.review-chip[data-state="self"]'),
    ).toHaveAttribute('aria-checked', 'true')
  })

  test('clicking the active chip issues a DELETE to clear back to "not reviewed"', async ({ page }) => {
    let reviewedBy: '' | 'self' | 'coach' = 'coach'
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1', reviewedBy)]),
      })
    })
    let sawDelete = false
    await page.route('**/api/v1/matches/m1/review', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'DELETE') {
        sawDelete = true
        reviewedBy = ''
        await route.fulfill({ status: 204, body: '' })
      } else if (req.method() === 'PUT') {
        const body = JSON.parse(req.postData() ?? '{}') as { reviewed_by?: string }
        reviewedBy = (body.reviewed_by ?? '') as '' | 'self' | 'coach'
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    // Sanity: starts on coach.
    await expect(
      page.locator('.review-chip[data-state="coach"]'),
    ).toHaveAttribute('aria-checked', 'true')

    // Click the active coach chip again → DELETE.
    await page.locator('.review-chip[data-state="coach"]').click()

    await expect.poll(() => sawDelete).toBe(true)
    await expect(
      page.locator('.review-chip[data-state="none"]'),
    ).toHaveAttribute('aria-checked', 'true')
  })

  test('switching between self and coach issues a single PUT', async ({ page }) => {
    let reviewedBy: '' | 'self' | 'coach' = 'self'
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1', reviewedBy)]),
      })
    })
    const sentBodies: string[] = []
    await page.route('**/api/v1/matches/m1/review', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'PUT') {
        const body = req.postData() ?? ''
        sentBodies.push(body)
        reviewedBy = (JSON.parse(body).reviewed_by ?? '') as '' | 'self' | 'coach'
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await page.locator('.review-chip[data-state="coach"]').click()

    await expect.poll(() => sentBodies.length).toBe(1)
    expect(JSON.parse(sentBodies[0]!)).toEqual({ reviewed_by: 'coach' })
    await expect(
      page.locator('.review-chip[data-state="coach"]'),
    ).toHaveAttribute('aria-checked', 'true')
  })
})
