/**
 * Hero-count buckets + hero-pool analysis.
 *
 * "Heroes per match" (a default-visible dossier widget) buckets games by how
 * many heroes were MEANINGFULLY played (a hero under 5% of the match — touched
 * the point — doesn't count). The "Hero Pool" full-width band (default-visible,
 * below the dossier) derives the user's pool (max(5, 10% of decisive games)
 * meaningful decisive games), splits games into in-pool vs out-of-pool, and
 * lists each out-of-pool hero's record. The same numbers surface as rows in
 * the Compare tab's Heroes section and the Hero pool size KPI.
 *
 * Corpus (threshold 5%):
 *   L1-7  lucio 100%            → 5W 2L
 *   B1-5  brig 100%             → 3W 2L
 *   A1-3  lucio 60% + ana 40%   → 1W 2L   (2-hero, ana out of pool)
 *   T1    lucio 97% + brig 3%   → W       (brig touch → SINGLE-hero game)
 *   X1    lucio 93% + genji 7%  → L       (2-hero at 5%, single at 10%)
 * Pool: lucio (12 decisive) + brig (5 decisive); ana (3) + genji (1) below floor.
 * Buckets: 1 hero = 13 games 69% · 2 heroes = 4 games 25%.
 * Split: in-pool 13 games 69% · out-of-pool 4 games 25%.
 */
import type { Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { test, expect } from './_fixtures'

function localYMD(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio', 'Brigitte', 'Ana'], dps: ['Genji'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [
    { name: 'Prev Season', chapter: 'C', number: 1, start: `${localYMD(-120)}T12:00:00Z`, end: `${localYMD(-60)}T12:00:00Z` },
    { name: 'This Season', chapter: 'C', number: 2, start: `${localYMD(-60)}T12:00:00Z`, end: `${localYMD(30)}T12:00:00Z` },
  ],
}

let seq = 0
function rec(result: string, heroes: [string, number][]) {
  seq++
  const utc = `${localYMD(-seq)}T12:00:00Z`
  return {
    match_key: `m${seq}`,
    source_files: [`${seq}.png`],
    parsed_at: utc,
    data: {
      map: 'ilios', playlist: 'competitive', hero: heroes[0]![0], role: 'support', result,
      date: utc.slice(0, 10), finished_at: '12:00', played_at_utc: utc, game_length: '10:00',
      eliminations: 10, assists: 5, deaths: 4,
      heroes_played: heroes.map(([hero, pct]) => ({ hero, percent_played: pct, play_time: '05:00' })),
    },
  }
}

function corpus() {
  seq = 0
  return [
    ...['victory', 'victory', 'victory', 'victory', 'victory', 'defeat', 'defeat']
      .map((r) => rec(r, [['lucio', 100]])),
    ...['victory', 'victory', 'victory', 'defeat', 'defeat']
      .map((r) => rec(r, [['brigitte', 100]])),
    ...['victory', 'defeat', 'defeat']
      .map((r) => rec(r, [['lucio', 60], ['ana', 40]])),
    rec('victory', [['lucio', 97], ['brigitte', 3]]),
    rec('defeat', [['lucio', 93], ['genji', 7]]),
  ]
}

async function addWidget(page: Page, id: string) {
  await page.locator('[data-dossier-add]').click()
  await page.locator(`[data-widget-add="${id}"]`).click()
  await expect(page.locator(`[data-widget-id="${id}"]`)).toBeVisible()
  // The Add menu (and its scrim) stays open for multi-add — dismiss it so it
  // can't intercept clicks on the widget's own controls.
  await page.keyboard.press('Escape')
  await expect(page.locator('.dossier-manage-scrim')).toHaveCount(0)
}

test.describe('hero-count buckets + hero pool', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus()) }))
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('buckets games by meaningful hero count — a <5% touch is not a swap', async ({ page }) => {
    // Ships default-visible — no Add-menu trip needed.
    const widget = page.locator('.breakdown', { hasText: 'Heroes per match' })
    await expect(widget).toBeVisible()
    const rows = widget.locator('li:not(.bd-placeholder)')
    await expect(rows).toHaveCount(2) // no 3-hero or 4+ games in the corpus

    // 13 single-hero games at 69% — T1's 3% brig touch stayed single-hero.
    await expect(rows.nth(0)).toContainText('1 hero')
    await expect(rows.nth(0)).toContainText('13x')
    await expect(rows.nth(0)).toContainText('69%')
    // 4 two-hero games at 25%.
    await expect(rows.nth(1)).toContainText('2 heroes')
    await expect(rows.nth(1)).toContainText('4x')
    await expect(rows.nth(1)).toContainText('25%')
  })

  test('raising the threshold to 10% reclassifies the borderline 7% swap', async ({ page }) => {
    await page.locator('[data-widget-config-trigger="heroes-per-match"]').click()
    await page.locator('[data-widget-config-choice="thresholdPct=10"]').click()
    await page.locator('[data-testid="widget-config-save"]').click()

    const widget = page.locator('.breakdown', { hasText: 'Heroes per match' })
    const rows = widget.locator('li:not(.bd-placeholder)')
    // X1 (genji 7%) is now single-hero: 14 vs 3.
    await expect(rows.nth(0)).toContainText('14x')
    await expect(rows.nth(1)).toContainText('3x')
  })

  test('derives the pool, splits in/out games, and names the out-of-pool heroes', async ({ page }) => {
    // The Hero Pool BAND ships default-visible below the dossier grid.
    const widget = page.locator('.hero-pool-band')
    await expect(widget).toBeVisible()

    // Support-role pool = brig + lucio (alphabetical) — ana (3 games) and
    // genji (1) are below that role's floor. In-pool heroes carry data-pool-hero
    // without the out marker.
    const pool = widget.locator('[data-pool-hero]:not([data-pool-out-hero])')
    await expect(pool).toHaveCount(2)
    await expect(pool.nth(0)).toContainText(/brig/i)
    await expect(pool.nth(1)).toContainText(/l[úu]cio/i)
    // The Support role header groups them.
    await expect(widget.locator('[data-pool-role-header="support"]')).toContainText('Support')

    // The Support discipline: 13 in-pool games at 69%, 4 out-of-pool at 25%.
    await expect(widget.locator('[data-pool-side="pure"]')).toContainText('13')
    await expect(widget.locator('[data-pool-side="pure"]')).toContainText('69%')
    await expect(widget.locator('[data-pool-side="off"]')).toContainText('4')
    await expect(widget.locator('[data-pool-side="off"]')).toContainText('25%')

    // Out-of-pool heroes with their record — the "swap to ana rarely wins" story.
    const out = widget.locator('[data-pool-out-hero]')
    await expect(out).toHaveCount(2)
    await expect(widget.locator('[data-pool-out-hero]', { hasText: 'ana' })).toContainText('33%')
  })

  test('the Hero pool size KPI counts the DERIVED pool, with the roster as its subtitle', async ({ page }) => {
    await addWidget(page, 'hero-pool-size')
    const kpi = page.locator('.kpi-tile', { hasText: 'Hero pool size' })
    // 17 heroes touched would be wrong — the derived pool is lucio + brig.
    await expect(kpi.locator('.kpi-value')).toHaveText('2')
    await expect(kpi.locator('.kpi-sub')).toHaveText('brigitte, lucio') // role-sorted, then alphabetical
  })

  test("the Hero Pool band's gear re-derives the analysis at 10%", async ({ page }) => {
    await page.locator('[data-hero-pool-config-trigger]').click()
    await page.locator('[data-widget-config-choice="thresholdPct=10"]').click()
    await page.locator('[data-testid="widget-config-save"]').click()

    const widget = page.locator('.hero-pool-band')
    // X1's 7% genji no longer counts: it becomes a pure single-lucio game, so
    // the out-of-pool side drops to the 3 ana games and genji leaves the list.
    await expect(widget.locator('[data-pool-side="pure"]')).toContainText('14')
    await expect(widget.locator('[data-pool-side="off"]')).toContainText('3')
    await expect(widget.locator('[data-pool-out-hero]')).toHaveCount(1)
    await expect(widget.locator('[data-pool-out-hero]')).toContainText(/ana/i)
  })

  // Full-page axe over the POPULATED matches view with both widgets rendered.
  // The empty-corpus a11y.spec never renders the heatmap grid, leaf rows, or
  // result chips — this pass is what keeps those honest with real data.
  for (const theme of ['day', 'dark', 'night', 'high-contrast'] as const) {
    test(`populated matches view + both widgets has no axe violations — ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => {
        try { localStorage.setItem('recall.theme', t) } catch (_) { /* ignore */ }
      }, theme)
      await page.goto('/')
      await page.locator('#tab-matches').click()
      await expect(page.locator('.set-dossier')).toBeVisible()
      // Both surfaces ship default-visible: the buckets widget in the grid,
      // the Hero Pool band below it.
      await expect(page.locator('[data-pool-hero]').first()).toBeVisible()
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
    })
  }

  test('the Compare tab carries the pool + split rows', async ({ page }) => {
    await page.locator('#tab-compare').click()
    await expect(page.locator('[data-compare-row="heroPool"]')).toBeVisible()
    // Every match is in This Season (column B).
    await expect(page.locator('[data-compare-row="heroPool"] .compare-b')).toContainText(/cio/i)
    await expect(page.locator('[data-compare-row="heroPool"] .compare-b')).toContainText(/brigitte/i)
    await expect(page.locator('[data-compare-row="singleHero"] .compare-b')).toContainText('69% · 13g')
    await expect(page.locator('[data-compare-row="multiHero"] .compare-b')).toContainText('25% · 4g')
    await expect(page.locator('[data-compare-row="purePool"] .compare-b')).toContainText('69% · 13g')
    await expect(page.locator('[data-compare-row="outPool"] .compare-b')).toContainText('25% · 4g')
  })
})
