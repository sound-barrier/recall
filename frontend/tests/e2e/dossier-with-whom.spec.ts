/**
 * Dossier "Win rate by teammate" breakdown widget.
 *
 * Buckets the set by who you played WITH (annotation.members) — one row
 * per teammate, plus a "Solo" row for matches with no teammates tagged.
 * A match with members {Alice, Bob} counts toward BOTH rows, so the
 * buckets overlap by design. Bar width = win rate (the comparison axis);
 * the in-bar count is the sample-size guard. Opt-in: added from the
 * dossier "+ Add" gallery, not shipped in the default layout.
 */
import { test, expect } from './_fixtures'
import type { Page, Route } from '@playwright/test'

function record(matchKey: string, members: string[], result: 'victory' | 'defeat' | 'draw') {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result,
      date: '2026-05-10', finished_at: '22:00',
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
    annotation: { tags: [], leaver: '', note: '', members, replay_code: '' },
  }
}

// Alice: 3 games (2W/1L) → 67%. Bob: 2 games (1W/1L) → 50%.
// Solo: 1 game (1W) → 100%. Sorted by games desc: Alice, Bob, Solo.
const CORPUS = [
  record('m1', ['Alice', 'Bob'], 'victory'),
  record('m2', ['Alice', 'Bob'], 'defeat'),
  record('m3', ['Alice'], 'victory'),
  record('m4', [], 'victory'),
]

async function addWithWhomWidget(page: Page) {
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await page.locator('[data-dossier-add]').click()
  await page.locator('[data-widget-add="with-whom"]').click()
  await expect(page.locator('[data-widget-id="with-whom"]')).toBeVisible()
}

test.describe('dossier — Win rate by teammate', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
  })

  test('one row per teammate plus a Solo baseline, ranked by games together', async ({ page }) => {
    await addWithWhomWidget(page)
    const widget = page.locator('[data-widget-id="with-whom"]')
    await expect(widget.locator('.breakdown-eyebrow')).toHaveText('Win rate by teammate')
    await expect(widget.locator('li')).toHaveCount(3)

    // Alice leads (3 games), win rate on the bar + count overlay.
    const first = widget.locator('li').first()
    await expect(first.locator('.bd-name')).toHaveText('Alice')
    await expect(first.locator('.bd-time')).toHaveText('3x')
    await expect(first.locator('.bd-stats')).toHaveText('67%')
    await expect(first.locator('.bd-fill')).toHaveAttribute('style', /width:\s*67%/)

    // The Solo baseline row exists.
    await expect(widget.locator('.bd-name', { hasText: /^Solo$/ })).toBeVisible()
  })

  test('empty corpus shows the teach-me empty state, no rows', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await addWithWhomWidget(page)
    const widget = page.locator('[data-widget-id="with-whom"]')
    await expect(widget.locator('li')).toHaveCount(0)
    await expect(widget.locator('.breakdown-empty')).toContainText(/tag teammates/i)
  })
})
