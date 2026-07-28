/**
 * Markdown export + copy-summary E2E.
 *
 * The detail panel toolbar gains two clipboard affordances: "Copy as
 * Markdown" (the three-section coach-review blob: stats table, journal,
 * screenshot refs) and "Copy summary" (a compact one-liner for Discord).
 * Both write through navigator.clipboard — stubbed here so the payloads
 * are assertable.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEY = 'match-2026-05-10T21-00-00'

const record = () => ({
  match_key: KEY,
  source_files: [`${KEY}.png`],
  source_types: { [`${KEY}.png`]: 'teams' },
  data: {
    map: 'rialto',
    playlist: 'competitive',
    hero: 'lucio',
    result: 'victory',
    final_score: '3-1',
    date: '2026-05-10',
    finished_at: '21:00',
    game_length: '11:25',
    eliminations: 17,
    assists: 16,
    deaths: 11,
    damage: 12843,
    healing: 9021,
    mitigation: 3310,
  },
  parsed_at: '2026-05-10T22:00:00Z',
  annotation: { leavers: [], throwers: [], note: 'clutch overtime hold', replay_code: 'AB12CD', members: ['Apollo'], tags: ['stack'] },
})

test.describe('match markdown export', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as unknown as { __copied: string[] }).__copied = []
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: (t: string) => {
            ;(window as unknown as { __copied: string[] }).__copied.push(t)
            return Promise.resolve()
          },
        },
        configurable: true,
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record()]),
      })
    })
  })

  async function copied(page: import('@playwright/test').Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)
  }

  test('Copy as Markdown writes the three-section blob', async ({ page }) => {
    await page.goto('/')
    await page.locator('.leaf-row').first().click()

    await page.locator('[data-copy-markdown]').click()
    await expect.poll(async () => (await copied(page)).length).toBe(1)
    const md = (await copied(page))[0]!
    expect(md).toContain('# ')
    expect(md).toContain('| E / A / D | 17 / 16 / 11 |')
    expect(md).toContain('clutch overtime hold')
    expect(md).toContain('`AB12CD`')
    expect(md).toContain(`${KEY}.png`)
  })

  test('Copy summary writes the compact one-liner', async ({ page }) => {
    await page.goto('/')
    await page.locator('.leaf-row').first().click()

    await page.locator('[data-copy-summary]').click()
    await expect.poll(async () => (await copied(page)).length).toBe(1)
    const line = (await copied(page))[0]!
    expect(line).not.toContain('\n')
    expect(line).toMatch(/17\/16\/11/)
    expect(line).toMatch(/victory/i)
    expect(line).toContain('AB12CD')
  })
})
