/**
 * Dossier role-share breakdown widget.
 *
 * Mirrors topMaps + topHeroes layout (bar + in-bar count + right-side
 * %) but with overlap-aware percentages: an open-queue match where
 * the user played both a tank and a support contributes to BOTH role
 * counts, so the row's percentages can sum past 100%.
 *
 * Tests stub `/api/v1/system/reference-data` so useOWData's hero→role
 * resolver returns canonical roles for the corpus.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

const REFERENCE_DATA = {
  heroes_by_role: {
    tank:    ['Reinhardt', 'Roadhog'],
    dps:     ['Tracer',    'Soldier: 76'],
    support: ['Lúcio',     'Ana'],
  },
  maps_by_type: {
    control: ['Rialto'],
  },
}

function record(matchKey: string, opts: {
  primary?: 'tank' | 'dps' | 'support'
  heroes?: string[]
  result?: 'victory' | 'defeat' | 'draw'
}) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', type: 'control',
      role: opts.primary,
      hero: (opts.heroes ?? [])[0],
      result: opts.result ?? 'victory',
      date: '2026-05-10', finished_at: '22:00',
      heroes_played: (opts.heroes ?? []).map((h) => ({
        hero: h, percent_played: 50, play_time: '05:00',
      })),
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

test.describe('dossier — Most played roles breakdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/system/reference-data', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(REFERENCE_DATA),
      })
    })
  })

  test('renders the row with count inside the bar and percent on the right', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          record('m1', { primary: 'tank',    heroes: ['reinhardt'] }),
          record('m2', { primary: 'tank',    heroes: ['roadhog']   }),
          record('m3', { primary: 'support', heroes: ['lucio']     }),
          record('m4', { primary: 'dps',     heroes: ['tracer']    }),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()

    const article = page.locator('[data-breakdown="roles"]')
    await expect(article).toBeVisible()
    await expect(article.locator('.breakdown-eyebrow')).toHaveText('Most played roles')

    // 3 rows always — tank, dps, support.
    await expect(article.locator('li')).toHaveCount(3)

    // Tank is dominant (2/4) → first row, "2x", 50%.
    const first = article.locator('li').first()
    await expect(first.locator('.bd-name')).toHaveText(/tank/i)
    await expect(first.locator('.bd-time')).toHaveText('2x')
    await expect(first.locator('.bd-stats')).toHaveText('50%')
  })

  test('open-queue overlap pushes the row sum past 100%', async ({ page }) => {
    // Two matches; both swap tank↔(support OR dps). Tank appears in
    // both = 100%; support and dps each in one = 50% — sum 200%.
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          record('m1', { heroes: ['reinhardt', 'lucio']  }),
          record('m2', { heroes: ['roadhog',   'tracer'] }),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()

    const article = page.locator('[data-breakdown="roles"]')
    const shares = await article.locator('.bd-stats').allTextContents()
    // Parse "NN%" → number; sum must exceed 100.
    const total = shares.map((s) => Number(s.replace('%', ''))).reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(100)

    // Dominant row (tank, 2x, 100%) sits first.
    const first = article.locator('li').first()
    await expect(first.locator('.bd-name')).toHaveText(/tank/i)
    await expect(first.locator('.bd-time')).toHaveText('2x')
    await expect(first.locator('.bd-stats')).toHaveText('100%')
  })

  test('empty corpus renders 0x / 0% for every role without crashing', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    const article = page.locator('[data-breakdown="roles"]')
    await expect(article.locator('li')).toHaveCount(3)
    for (const txt of await article.locator('.bd-stats').allTextContents()) {
      expect(txt).toBe('0%')
    }
  })
})
