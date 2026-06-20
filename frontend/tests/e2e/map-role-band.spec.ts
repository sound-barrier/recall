/**
 * Geography — Map × Role performance band (Matches view).
 *
 * An always-shown full-width band rendered after the Campaign Log: 3
 * role rows (Tank / DPS / Support) × every map as a column, grouped by
 * game-mode and alphabetical within each group. Cells are tinted by
 * win rate (green→red) and dimmed by volume. Cells / role labels / map
 * names are spreadsheet-style selectable (click / Ctrl-toggle / drag-box);
 * the selection feeds a combined readout + a "Filter to selection" button.
 * A game-mode group header still narrows to that game-mode.
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

// Support: Rialto 2-1 (67%), plus Dorado + Ilios so a row-select spans 3 cells;
// Tank wins on Ilios; DPS loses on Rialto. Five played cells in the 3×3 grid —
// enough that ilios|tank + rialto|support is a genuinely non-rectangular pick.
const CORPUS = [
  match('m1', 'rialto', 'escort', 'support', 'lucio', 'victory', '10:01'),
  match('m2', 'rialto', 'escort', 'support', 'lucio', 'victory', '10:02'),
  match('m3', 'rialto', 'escort', 'support', 'lucio', 'defeat', '10:03'),
  match('m4', 'ilios', 'control', 'tank', 'reinhardt', 'victory', '10:04'),
  match('m5', 'rialto', 'escort', 'dps', 'tracer', 'defeat', '10:05'),
  match('m6', 'dorado', 'escort', 'support', 'lucio', 'victory', '10:06'),
  match('m7', 'ilios', 'control', 'support', 'lucio', 'victory', '10:07'),
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

  test('selecting a cell highlights only it (no live-narrow); "Filter to selection" applies it', async ({ page }) => {
    const band = page.locator('.match-map-role')
    const chips = page.locator('ul.active-chips')
    const cell = () => band.locator('.mr-cell[aria-label*="Support on Rialto"]')

    await cell().click()
    await expect(cell()).toHaveClass(/selected/)
    await expect(band.locator('.mr-cell.selected')).toHaveCount(1)
    // Selecting no longer narrows — no active chip yet.
    await expect(chips.locator('.active-chip', { hasText: 'rialto' })).toHaveCount(0)
    // The combined readout shows this cell's record (rialto|support = 2-1, 67% over 3).
    const stats = band.locator('[data-mr-selection-stats]')
    await expect(stats).toContainText(/2.1.0/)
    await expect(stats).toContainText('67% WR')
    await expect(stats).toContainText('3 games')

    // The button pushes the pick into the set.
    await band.locator('[data-mr-filter-selection]').click()
    await expect(chips.locator('.active-chip', { hasText: 'rialto' })).toBeVisible()
    await expect(chips.locator('.active-chip', { hasText: 'support' })).toBeVisible()

    // Re-clicking the lone selected cell clears it (click off).
    await cell().click()
    await expect(band.locator('.mr-cell.selected')).toHaveCount(0)
  })

  test('Ctrl/Cmd-click adds non-contiguous cells; the readout sums them + flags a non-rectangular filter', async ({ page }) => {
    const band = page.locator('.match-map-role')
    await band.locator('.mr-cell[aria-label*="Tank on Ilios"]').click()
    await band.locator('.mr-cell[aria-label*="Support on Rialto"]').click({ modifiers: ['ControlOrMeta'] })
    await expect(band.locator('.mr-cell.selected')).toHaveCount(2)
    // ilios|tank 1-0-0 + rialto|support 2-1-0 = 3-1-0.
    await expect(band.locator('[data-mr-selection-stats]')).toContainText(/3.1.0/)
    // The hull {ilios,rialto}×{tank,support} has ilios|support selectable + unpicked
    // → filtering would be a superset → the note shows.
    await expect(band.locator('[data-mr-hull-note]')).toBeVisible()
  })

  test('clicking a role label selects the whole row, a map name the whole column', async ({ page }) => {
    const band = page.locator('.match-map-role')
    // Support played on Rialto, Dorado, Ilios → 3 cells.
    await band.locator('[data-mr-row="support"]').click()
    await expect(band.locator('.mr-cell.selected')).toHaveCount(3)
    await expect(band.locator('[data-mr-selection-bar]')).toBeVisible()

    // Rialto column → support + dps played = 2 cells (replaces the row pick).
    await band.locator('[data-mr-col="rialto"]').click()
    await expect(band.locator('.mr-cell.selected')).toHaveCount(2)
  })

  test('the Clear button empties the selection', async ({ page }) => {
    const band = page.locator('.match-map-role')
    await band.locator('[data-mr-row="support"]').click()
    await expect(band.locator('.mr-cell.selected')).toHaveCount(3)
    await band.locator('[data-mr-selection-clear]').click()
    await expect(band.locator('.mr-cell.selected')).toHaveCount(0)
    await expect(band.locator('[data-mr-selection-bar]')).toHaveCount(0)
  })

  test('keeps the full role grid after a selection instead of collapsing to the selected row', async ({ page }) => {
    const band = page.locator('.match-map-role')
    await expect(band.locator('.mr-rowhead')).toHaveCount(3)
    await band.locator('.mr-cell[aria-label*="Support on Rialto"]').click()
    await expect(band.locator('.mr-cell.selected')).toHaveCount(1)
    await expect(band.locator('.mr-rowhead')).toHaveCount(3)
    // Cells stay selectable → switch picks directly (calendar-style).
    await band.locator('.mr-cell[aria-label*="Tank on Ilios"]').click()
    await expect(band.locator('.mr-cell[aria-label*="Tank on Ilios"]')).toHaveClass(/selected/)
    await expect(band.locator('.mr-cell.selected')).toHaveCount(1)
    await expect(band.locator('.mr-rowhead')).toHaveCount(3)
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
