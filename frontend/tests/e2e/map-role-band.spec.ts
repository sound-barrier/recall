/**
 * Geography — Map × Role performance band (Matches view).
 *
 * An always-shown full-width band rendered after the Campaign Log: 3
 * role rows (Tank / DPS / Support) × every map as a column, grouped by
 * game-mode and alphabetical within each group. Cells are tinted by
 * win rate (green→red) and dimmed by volume. Clicking a cell narrows
 * the active set to that (map, role) pair; clicking a game-mode group
 * header narrows to that game-mode.
 *
 * Unlike the opt-in dossier widgets, the band needs no layout seeding —
 * it's fixed chrome. We DO mock /api/v1/system/reference-data so the
 * column roster (maps_by_game_mode) is deterministic instead of depending
 * on the real compiled-in roster.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

// Three days ago, as YYYY-MM-DD — comfortably inside every window
// (1M/3M/6M/12M) regardless of the test machine's clock.
const RECENT = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 3)
  return d.toISOString().slice(0, 10)
})()

const REFERENCE_DATA = {
  heroes_by_role: {
    tank: ['Reinhardt'],
    dps: ['Tracer'],
    support: ['Lucio'],
  },
  // Two game-mode groups; Escort has two maps so we can assert alpha order
  // (Dorado before Rialto).
  maps_by_game_mode: {
    control: ['Ilios'],
    escort: ['Dorado', 'Rialto'],
  },
}

const match = (
  key: string,
  map: 'ilios' | 'dorado' | 'rialto',
  game_mode: 'control' | 'escort',
  role: 'tank' | 'dps' | 'support',
  hero: string,
  result: 'victory' | 'defeat',
  finished: string,
) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map,
    game_mode,
    role,
    hero,
    result,
    // Recent so the band's default 6M window (and the narrowest 1M)
    // always includes the corpus regardless of the test machine's clock.
    date: RECENT,
    finished_at: finished,
    playlist: 'competitive',
    heroes_played: [{ hero, play_time: '10:00', percent_played: 100 }],
  },
  parsed_at: `${RECENT}T${finished}:00Z`,
})

// Support has a real record on Rialto (2-1 → 67%); Tank wins on Ilios;
// DPS loses on Rialto. The rest of the 3×3 grid stays empty.
const CORPUS = [
  match('m1', 'rialto', 'escort', 'support', 'lucio', 'victory', '10:01'),
  match('m2', 'rialto', 'escort', 'support', 'lucio', 'victory', '10:02'),
  match('m3', 'rialto', 'escort', 'support', 'lucio', 'defeat', '10:03'),
  match('m4', 'ilios', 'control', 'tank', 'reinhardt', 'victory', '10:04'),
  match('m5', 'rialto', 'escort', 'dps', 'tracer', 'defeat', '10:05'),
]

test.describe('Geography — Map × Role band', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(CORPUS),
      })
    })
    await page.route('**/api/v1/system/reference-data', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(REFERENCE_DATA),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('renders a 3-role × all-maps grid grouped by type', async ({ page }) => {
    const band = page.locator('.match-map-role')
    await expect(band).toBeVisible()
    // Three role rows.
    await expect(band.locator('.mr-rowhead')).toHaveCount(3)
    // Three map columns (1 control + 2 escort) and two game-mode group heads.
    await expect(band.locator('.mr-collabel')).toHaveCount(3)
    await expect(band.locator('.mr-modehead')).toHaveCount(2)
    // 3 roles × 3 maps = 9 cells.
    await expect(band.locator('.mr-cell')).toHaveCount(9)
    // Alphabetical within Escort: Dorado precedes Rialto.
    const labels = await band.locator('.mr-collabel').allInnerTexts()
    const dorado = labels.findIndex((t) => /dorado/i.test(t))
    const rialto = labels.findIndex((t) => /rialto/i.test(t))
    expect(dorado).toBeGreaterThanOrEqual(0)
    expect(rialto).toBeGreaterThan(dorado)
  })

  test('clicking a populated cell narrows to that (map, role)', async ({ page }) => {
    const band = page.locator('.match-map-role')
    const cell = band.locator('.mr-cell[aria-label*="Support on Rialto"]')
    await expect(cell).toBeVisible()
    await cell.click()

    const chips = page.locator('ul.active-chips')
    await expect(chips).toBeVisible()
    await expect(chips.locator('.active-chip', { hasText: 'rialto' })).toBeVisible()
    await expect(chips.locator('.active-chip', { hasText: 'support' })).toBeVisible()
  })

  test('clicking a game-mode group header narrows to that game-mode', async ({ page }) => {
    const band = page.locator('.match-map-role')
    await band.locator('.mr-modehead', { hasText: 'Escort' }).click()

    const chips = page.locator('ul.active-chips')
    await expect(chips.locator('.active-chip', { hasText: 'escort' })).toBeVisible()
  })

  test('offers a 1M/3M/6M/12M window toggle, defaulting to 6M', async ({ page }) => {
    const band = page.locator('.match-map-role')
    await expect(band.locator('.mr-window-btn')).toHaveText(['1M', '3M', '6M', '12M'])
    await expect(band.locator('.mr-window-btn.active')).toHaveText('6M')
    // Switching to 1M keeps the (recent) corpus visible — the Rialto
    // support cell is still populated.
    await band.locator('.mr-window-btn', { hasText: '1M' }).click()
    await expect(band.locator('.mr-window-btn.active')).toHaveText('1M')
    await expect(band.locator('.mr-cell[aria-label*="Support on Rialto"]')).toBeVisible()
  })
})

test.describe('Geography — never-played roles + empty state', () => {
  async function open(page: import('@playwright/test').Page, matches: unknown[]) {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(matches) })
    })
    await page.route('**/api/v1/system/reference-data', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  }

  // Each role, when never played, drops out — and the remaining rows keep the
  // canonical Tank → DPS → Support order. Parameterized so a future hardcoded
  // role or a row-ordering regression fails loudly for the specific role.
  const ROLE_CASES = [
    {
      hidden: 'Tank',
      matches: [
        match('m1', 'rialto', 'escort', 'support', 'lucio', 'victory', '10:01'),
        match('m2', 'rialto', 'escort', 'dps', 'tracer', 'victory', '10:02'),
      ],
      rows: ['DPS', 'Support'],
    },
    {
      hidden: 'DPS',
      matches: [
        match('m1', 'ilios', 'control', 'tank', 'reinhardt', 'victory', '10:01'),
        match('m2', 'rialto', 'escort', 'support', 'lucio', 'victory', '10:02'),
      ],
      rows: ['Tank', 'Support'],
    },
    {
      hidden: 'Support',
      matches: [
        match('m1', 'ilios', 'control', 'tank', 'reinhardt', 'victory', '10:01'),
        match('m2', 'rialto', 'escort', 'dps', 'tracer', 'victory', '10:02'),
      ],
      rows: ['Tank', 'DPS'],
    },
  ] as const

  for (const c of ROLE_CASES) {
    test(`hides the ${c.hidden} row when ${c.hidden} was never played`, async ({ page }) => {
      await open(page, [...c.matches])
      const band = page.locator('.match-map-role')
      await expect(band).toBeVisible()
      await expect(band.locator('.mr-rowhead')).toHaveText([...c.rows])
      await expect(band.locator('.mr-rowhead', { hasText: c.hidden })).toHaveCount(0)
    })
  }

  test('prompts to play a match in all three bands when there are none', async ({ page }) => {
    await open(page, [])
    const prompt = 'At least 1 match must be played to display data'

    // Geography — no grid, the prompt instead.
    const geography = page.locator('.match-map-role')
    await expect(geography).toBeVisible()
    await expect(geography.locator('.mr-grid')).toHaveCount(0)
    await expect(geography.locator('[data-mr-no-data]')).toContainText(prompt)

    // Campaign Log — prompt instead of the heatmap + sparkline.
    const campaignLog = page.locator('.match-timeline')
    await expect(campaignLog).toBeVisible()
    await expect(campaignLog.locator('[data-timeline-no-data]')).toContainText(prompt)

    // Hero × Game-Mode — prompt instead of the floor message.
    const heroMode = page.locator('.hero-mode-band')
    await expect(heroMode).toBeVisible()
    await expect(heroMode.locator('[data-hm-no-data]')).toContainText(prompt)
  })
})
