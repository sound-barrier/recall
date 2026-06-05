/**
 * Per-match play-mode toggle in the detail-panel sidebar PLUS the
 * Play mode chip in the "Narrow this set" filter.
 *
 * The toggle sits BETWEEN the queue chooser (top) and the review
 * chooser (bottom). Three mutually-exclusive states:
 *
 *   ⬡  Not set      (default; absent play_mode; fall back to parser)
 *   ◎  Quickplay    (casual)
 *   ◆  Competitive  (ranked)
 *
 * REST: `PUT /api/v1/matches/{matchKey}/play-mode {play_mode}`
 * sets; `DELETE` clears. Both 204.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function record(matchKey: string, playMode: '' | 'quickplay' | 'competitive' = '') {
  const rec: Record<string, unknown> = {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map: 'rialto', mode: '', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11, damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
      final_score: '3-2',
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
  if (playMode) rec.play_mode = playMode
  return rec
}

test.describe('match play-mode toggle — panel sidebar', () => {
  test('sits between the queue chooser (above) and the review chooser (below)', async ({ page }) => {
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

    await expect(page.locator('.play-mode-chooser')).toBeVisible()

    // Queue chooser is first, play-mode second, review third.
    const orderedClasses = await page.evaluate(() => {
      const body = document.querySelector('.detail-body')
      if (!body) return []
      const known = ['queue-chooser', 'play-mode-chooser', 'review-chooser']
      const order: string[] = []
      for (const el of Array.from(body.querySelectorAll('*'))) {
        for (const cls of known) {
          if (el.classList.contains(cls) && !order.includes(cls)) {
            order.push(cls)
          }
        }
      }
      return order
    })
    expect(orderedClasses).toEqual(['queue-chooser', 'play-mode-chooser', 'review-chooser'])
  })

  test('starts in the "not set" state when play_mode is absent', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1')]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await expect(page.locator('.play-mode-chip[data-state="none"]')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.play-mode-chip[data-state="quickplay"]')).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.play-mode-chip[data-state="competitive"]')).toHaveAttribute('aria-checked', 'false')
  })

  test('clicking "Quickplay" PUTs play_mode=quickplay and the chip flips active', async ({ page }) => {
    let playMode: '' | 'quickplay' | 'competitive' = ''
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1', playMode)]),
      })
    })
    let lastPutBody: string | null = null
    await page.route('**/api/v1/matches/m1/play-mode', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'PUT') {
        lastPutBody = req.postData()
        const body = JSON.parse(lastPutBody ?? '{}') as { play_mode?: string }
        playMode = (body.play_mode ?? '') as '' | 'quickplay' | 'competitive'
        await route.fulfill({ status: 204, body: '' })
      } else if (req.method() === 'DELETE') {
        playMode = ''
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await page.locator('.play-mode-chip[data-state="quickplay"]').click()

    await expect.poll(() => lastPutBody).not.toBeNull()
    expect(JSON.parse(lastPutBody!)).toEqual({ play_mode: 'quickplay' })

    await expect(page.locator('.play-mode-chip[data-state="quickplay"]')).toHaveAttribute('aria-checked', 'true')
  })

  test('clicking the active chip issues a DELETE to clear back to "not set"', async ({ page }) => {
    let playMode: '' | 'quickplay' | 'competitive' = 'competitive'
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1', playMode)]),
      })
    })
    let sawDelete = false
    await page.route('**/api/v1/matches/m1/play-mode', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'DELETE') {
        sawDelete = true
        playMode = ''
        await route.fulfill({ status: 204, body: '' })
      } else if (req.method() === 'PUT') {
        const body = JSON.parse(req.postData() ?? '{}') as { play_mode?: string }
        playMode = (body.play_mode ?? '') as '' | 'quickplay' | 'competitive'
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await expect(page.locator('.play-mode-chip[data-state="competitive"]')).toHaveAttribute('aria-checked', 'true')

    await page.locator('.play-mode-chip[data-state="competitive"]').click()

    await expect.poll(() => sawDelete).toBe(true)
    await expect(page.locator('.play-mode-chip[data-state="none"]')).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('narrow this set — Play mode filter', () => {
  test('picking Quickplay narrows to only quickplay matches', async ({ page }) => {
    const corpus = [
      record('mc1', 'competitive'),
      record('mc2', 'competitive'),
      record('mq1', 'quickplay'),
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

    await page.locator('button:has-text("Narrow this set")').click()
    await page.locator('.np-chip[data-play-mode="quickplay"]').click()

    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })
})
