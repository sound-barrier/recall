/**
 * Per-match queue-type toggle in the detail-panel sidebar PLUS the
 * Queue chip in the "Narrow this set" filter.
 *
 * The toggle is the VERY TOP of the panel body — above even the
 * review chooser — because queue type frames every downstream stat
 * (5v5 winrate ≠ 6v6 winrate). Three mutually exclusive states:
 *
 *   ⬡  Not set     (default; absent queue_type)
 *   ▣  Role Queue  (5v5)
 *   ◇  Open Queue  (6v6)
 *
 * REST shape: `PUT /api/v1/matches/{matchKey}/queue {queue_type}`
 * to set; `DELETE` to clear. Both 204.
 *
 * Mirrors the review-status toggle spec at match-review-toggle.spec.ts.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function record(matchKey: string, queueType: '' | 'role' | 'open' = '') {
  const rec: Record<string, unknown> = {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map: 'rialto', mode: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11, damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
      final_score: '3-2',
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
  if (queueType) rec.queue_type = queueType
  return rec
}

test.describe('match queue-type toggle — panel sidebar', () => {
  test('sits above the review chooser at the very top of the panel body', async ({ page }) => {
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

    const chooser = page.locator('.queue-chooser')
    await expect(chooser).toBeVisible()

    // The queue chooser is the FIRST major section in the panel body —
    // above the review chooser.
    const firstSectionClass = await page.evaluate(() => {
      const body = document.querySelector('.detail-body')
      if (!body) return null
      const known = ['queue-chooser', 'review-chooser', 'detail-meta-strip']
      const walker = body.querySelectorAll('*')
      for (const el of Array.from(walker)) {
        for (const cls of known) {
          if (el.classList.contains(cls)) return cls
        }
      }
      return null
    })
    expect(firstSectionClass).toBe('queue-chooser')
  })

  test('starts in the "not set" state when queue_type is absent', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1')]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await expect(page.locator('.queue-chip[data-state="none"]')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.queue-chip[data-state="role"]')).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.queue-chip[data-state="open"]')).toHaveAttribute('aria-checked', 'false')
  })

  test('clicking "Role Queue" PUTs queue_type=role and the chip flips active', async ({ page }) => {
    let queueType: '' | 'role' | 'open' = ''
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1', queueType)]),
      })
    })
    let lastPutBody: string | null = null
    await page.route('**/api/v1/matches/m1/queue', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'PUT') {
        lastPutBody = req.postData()
        const body = JSON.parse(lastPutBody ?? '{}') as { queue_type?: string }
        queueType = (body.queue_type ?? '') as '' | 'role' | 'open'
        await route.fulfill({ status: 204, body: '' })
      } else if (req.method() === 'DELETE') {
        queueType = ''
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await page.locator('.queue-chip[data-state="role"]').click()

    await expect.poll(() => lastPutBody).not.toBeNull()
    expect(JSON.parse(lastPutBody!)).toEqual({ queue_type: 'role' })

    await expect(page.locator('.queue-chip[data-state="role"]')).toHaveAttribute('aria-checked', 'true')
  })

  test('clicking the active chip issues a DELETE to clear back to "not set"', async ({ page }) => {
    let queueType: '' | 'role' | 'open' = 'open'
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1', queueType)]),
      })
    })
    let sawDelete = false
    await page.route('**/api/v1/matches/m1/queue', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'DELETE') {
        sawDelete = true
        queueType = ''
        await route.fulfill({ status: 204, body: '' })
      } else if (req.method() === 'PUT') {
        const body = JSON.parse(req.postData() ?? '{}') as { queue_type?: string }
        queueType = (body.queue_type ?? '') as '' | 'role' | 'open'
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await expect(page.locator('.queue-chip[data-state="open"]')).toHaveAttribute('aria-checked', 'true')

    await page.locator('.queue-chip[data-state="open"]').click()

    await expect.poll(() => sawDelete).toBe(true)
    await expect(page.locator('.queue-chip[data-state="none"]')).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('narrow this set — Queue filter', () => {
  test('picking Open Queue narrows to only open-queue matches', async ({ page }) => {
    const corpus = [
      record('mr1', 'role'),
      record('mr2', 'role'),
      record('mo1', 'open'),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(corpus),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // Open the narrow panel and pick Open Queue.
    await page.locator('button:has-text("Filter matches")').click()
    await page.locator('.np-chip[data-queue-type="open"]').click()

    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })
})
