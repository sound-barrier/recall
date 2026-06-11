/**
 * Set-workspace E2E — covers the production-grade Matches page that
 * frames the page around the *set* of matches:
 *
 *   • Dossier headline + KPI tiles + top maps/heroes breakdown
 *   • Left-side "Narrow this set" filter panel (modal contract:
 *     focus trap, Esc closes, backdrop closes, background inert)
 *   • Members list with sort + group controls, redesigned rows
 *     (7-cell grid, every variable-count element bundled into a
 *     sub-block so the grid never spills into implicit columns)
 *   • Row click opens the existing right-side MatchDetailPanel
 *
 * Unknown-map matches are hidden by default — they live in the
 * Unknown tab. The narrow panel exposes a toggle to surface them
 * for one-off investigations.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

interface Stub {
  match_key: string
  date: string
  map: string | null
  hero: string
  role: 'tank' | 'support' | 'dps'
  type: string
  result: 'victory' | 'defeat' | 'draw'
}

function record(s: Stub, idx: number) {
  const finishedAt = `${String(18 + (idx % 4)).padStart(2, '0')}:${String((idx * 13) % 60).padStart(2, '0')}`
  return {
    match_key: s.match_key,
    source_files: [`${s.match_key}.png`],
    source_types: { [`${s.match_key}.png`]: 'summary' },
    data: {
      map: s.map ?? undefined,
      playlist: 'competitive',
      game_mode: s.type,
      role: s.role,
      hero: s.hero,
      result: s.result,
      date: s.date,
      finished_at: finishedAt,
      eliminations: 10 + idx,
      assists: 4 + (idx % 5),
      deaths: 3 + (idx % 4),
      heroes_played: [{ hero: s.hero, percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: `${s.date}T22:30:00Z`,
  }
}

// 3× lijiang, 2× rialto, 1 unknown-map (hidden by default).
const STUBS: Stub[] = [
  { match_key: 'm1', date: '2026-05-10', map: 'lijiang tower', hero: 'lucio',    role: 'support', game_mode: 'control',    result: 'victory' },
  { match_key: 'm2', date: '2026-05-10', map: 'lijiang tower', hero: 'mercy',    role: 'support', game_mode: 'control',    result: 'defeat' },
  { match_key: 'm3', date: '2026-05-11', map: 'lijiang tower', hero: 'lucio',    role: 'support', game_mode: 'control',    result: 'victory' },
  { match_key: 'm4', date: '2026-05-12', map: 'rialto',        hero: 'soldier',  role: 'dps',     game_mode: 'escort',     result: 'victory' },
  { match_key: 'm5', date: '2026-05-12', map: 'rialto',        hero: 'reinhardt',role: 'tank',    game_mode: 'escort',     result: 'defeat' },
  { match_key: 'unk',date: '2026-05-12', map: null,            hero: 'lucio',    role: 'support', game_mode: '',           result: 'victory' },
]
const CORPUS = STUBS.map((s, i) => record(s, i))

test.describe('matches set-workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('dossier surfaces the current set headline and counts', async ({ page }) => {
    // Unknown-map record is hidden by default → 5 leaves, not 6.
    await expect(page.locator('.dossier-title')).toContainText(/all matches/i)
    await expect(page.locator('.leaf-row')).toHaveCount(5)
    // 3 victories / 2 defeats / 0 draws across the 5 visible matches
    // = 60% winrate. The Record-as-W·L·D tile was replaced by Avg
    // K/D/A; the headline W/L/D lives in the masthead scoreboard.
    await expect(page.locator('.kpi-tile', { hasText: 'Winrate' }).locator('.kpi-value')).toHaveText('60%')
    await expect(page.locator('.scoreboard .score-num').nth(0)).toHaveText('3')
  })

  test('narrow panel opens with focus trap and inerts the background', async ({ page }) => {
    await page.locator('button:has-text("Filter matches")').click()
    const panel = page.locator('.left-panel')
    await expect(panel).toBeVisible()
    // Background container goes inert while panel is open — same
    // modal contract as MatchDetailPanel.
    await expect(page.locator('.container')).toHaveAttribute('inert', /.*/)
    await expect(page.locator('.container')).toHaveAttribute('aria-hidden', 'true')

    // Esc closes via focus trap.
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
    await expect(page.locator('.container')).not.toHaveAttribute('inert', /.*/)
  })

  test('search narrows the dossier + leaves live', async ({ page }) => {
    await page.locator('button:has-text("Filter matches")').click()
    const search = page.locator('#np-search')
    await search.fill('rialto')
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    await expect(page.locator('.dossier-meta')).toContainText(/2 of 6/i)
  })

  test('"/" shortcut focuses search when panel is closed', async ({ page }) => {
    // Make sure focus isn't already inside an input.
    await page.locator('.dossier-title').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('/')
    await expect(page.locator('.left-panel')).toBeVisible()
    // Search input owns focus.
    await expect(page.locator('#np-search')).toBeFocused()
  })

  test('click a row opens the right-side detail panel', async ({ page }) => {
    const firstRow = page.locator('.leaf-row').first()
    await firstRow.click()
    await expect(page.locator('.detail-panel')).toBeVisible()
  })

  test('group control inserts day dividers between rows', async ({ page }) => {
    // Default group = day, so two dividers expected (2026-05-10, -11, -12 minus the unknown date).
    const dividers = page.locator('.section-divider')
    await expect(dividers).toHaveCount(3)
    // Section dividers are left-aligned: label first, then a count, then the line.
    await expect(dividers.first().locator('.sd-label')).toBeVisible()
  })

  test('sort toggle flips chronology', async ({ page }) => {
    // Default sort = newest first. Verify by reading the first row's date.
    const firstDate = await page.locator('.leaf-row').first().locator('.leaf-when-date').textContent()
    // Open the Sort+Group popover and pick Oldest. (PR 6 replaced
    // the inline Sort/Group fieldsets with a single trigger + dropdown.)
    await page.locator('[data-sort-group-trigger]').click()
    await page.locator('[data-sort-pick="oldest"]').click()
    const newFirstDate = await page.locator('.leaf-row').first().locator('.leaf-when-date').textContent()
    expect(firstDate).not.toBe(newFirstDate)
  })

  test('include-unknown toggle surfaces the unknown-map row', async ({ page }) => {
    await page.locator('button:has-text("Filter matches")').click()
    const toggle = page.locator('label:has-text("Show unknown-map matches") input[type="checkbox"]')
    await toggle.check()
    await expect(page.locator('.leaf-row')).toHaveCount(6)
  })

  test('combobox picks narrow the set', async ({ page }) => {
    await page.locator('button:has-text("Filter matches")').click()
    // Hero combobox — broad-match against heroes_played + primary hero.
    const heroCombo = page.locator('[data-combo-id="hero"]')
    await heroCombo.locator('.combo-input').click()
    await heroCombo.locator('.combo-list li:has-text("lucio")').click()
    await page.keyboard.press('Escape')
    // 3 records have hero=lucio (m1, m3, unk — but unk is hidden by default).
    await expect(page.locator('.leaf-row')).toHaveCount(2)
  })
})
