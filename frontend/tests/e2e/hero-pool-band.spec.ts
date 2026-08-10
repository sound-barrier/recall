/**
 * Hero Pool band — the redesign.
 *
 * A fixed-height scrolling band (mirroring Hero × Game-Mode) with a 3-way mode
 * toggle: Role Queue (default, per-role pools with a role win %), Open Queue and
 * Quickplay (each one combined pool). The toggle defaults to "Showing" (no
 * global filter); picking a mode filters the whole set. Clicking a role, a hero,
 * or In-pool / Out-of-pool narrows the match set.
 *
 * Corpus:
 *   Competitive ROLE queue — tank: reinhardt 8 (5W/3L, in-pool); dps: tracer 6
 *     (4W/2L, in-pool); support: lucio 8 (6W/2L, in-pool), ana 3 (0W/3L, off-pool).
 *   Competitive OPEN queue — 6 matches (zarya + moira flex).
 *   Quickplay — 5 matches (junkrat).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const REFERENCE_DATA = {
  heroes_by_role: {
    tank: ['Reinhardt', 'Zarya'],
    dps: ['Tracer', 'Junkrat'],
    support: ['Lúcio', 'Ana', 'Moira'],
  },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [],
}

let seq = 0
interface RecOpts {
  result?: string
  hero?: string
  role?: string
  queue?: 'role' | 'open'
  mode?: 'competitive' | 'quickplay'
}
function rec(opts: RecOpts = {}) {
  seq++
  const utc = `2026-05-${String((seq % 27) + 1).padStart(2, '0')}T12:00:00Z`
  return {
    match_key: `m${seq}`,
    source_files: [`${seq}.png`],
    parsed_at: utc,
    queue_type: opts.queue ?? 'role',
    play_mode: opts.mode ?? 'competitive',
    data: {
      map: 'ilios', playlist: opts.mode ?? 'competitive',
      hero: opts.hero ?? 'lucio', role: opts.role ?? 'support', result: opts.result ?? 'victory',
      date: utc.slice(0, 10), finished_at: '12:00', played_at_utc: utc,
      heroes_played: [{ hero: opts.hero ?? 'lucio', percent_played: 100 }],
    },
  }
}
function games(n: number, wins: number, o: RecOpts) {
  return Array.from({ length: n }, (_, i) => rec({ ...o, result: i < wins ? 'victory' : 'defeat' }))
}

function corpus() {
  seq = 0
  return [
    ...games(8, 5, { hero: 'reinhardt', role: 'tank', queue: 'role' }),
    ...games(6, 4, { hero: 'tracer', role: 'dps', queue: 'role' }),
    ...games(8, 6, { hero: 'lucio', role: 'support', queue: 'role' }),
    ...games(3, 0, { hero: 'ana', role: 'support', queue: 'role' }), // off-pool
    ...games(6, 3, { hero: 'zarya', role: 'tank', queue: 'open' }),
    ...games(5, 2, { hero: 'junkrat', role: 'dps', queue: 'role', mode: 'quickplay' }),
  ]
}

async function openBand(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/system/reference-data', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
  await page.route('**/api/v1/matches', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus()) }))
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await expect(page.locator('.hero-pool-band')).toBeVisible()
}

test.describe('Hero Pool band', () => {
  test('defaults to Role Queue in a fixed-height scroll pane with per-role win %', async ({ page }) => {
    await openBand(page)
    // 3-way mode toggle, Role Queue selected by default.
    await expect(page.locator('[data-pool-mode="role"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-pool-mode="open"]')).toBeVisible()
    await expect(page.locator('[data-pool-mode="quickplay"]')).toBeVisible()
    // Fixed-height scroll container.
    const pane = page.locator('[data-pool-scroll]')
    await expect(pane).toBeVisible()
    await expect(pane).toHaveCSS('overflow-y', 'auto')
    // Role headers show a role win %: support = 6/13 decisive across lucio+ana? no —
    // role win % is decisive W/L on role-queue matches with that role: support 6W/5L.
    const support = page.locator('[data-pool-role-header="support"]')
    await expect(support).toContainText('%')
  })

  test('clicking a role narrows the whole set', async ({ page }) => {
    await openBand(page)
    const rowsBefore = await page.locator('.leaf-row').count()
    await page.locator('[data-pool-role-header="tank"]').click()
    // Narrowed to tank role-queue matches (8 reinhardt) — fewer rows than before.
    await expect.poll(async () => page.locator('.leaf-row').count()).toBeLessThan(rowsBefore)
  })

  test('clicking a hero narrows to that hero', async ({ page }) => {
    await openBand(page)
    await page.locator('[data-pool-hero="reinhardt"]').click()
    await expect.poll(async () => page.locator('.leaf-row').count()).toBe(8)
  })

  test('selecting a role Out-of-pool narrows to that role off-pool matches', async ({ page }) => {
    await openBand(page)
    // Support's pool = lucio (8); ana (3) is off — so Support Out-of-pool → 3
    // matches (per-role pool: tank/dps have no off-pool hero of their own).
    await page.locator('[data-pool-side="off"][data-pool-role="support"]').click()
    await expect.poll(async () => page.locator('.leaf-row').count()).toBe(3)
  })

  test('Open Queue and Quickplay show one combined pool (no role headers)', async ({ page }) => {
    await openBand(page)
    await page.locator('[data-pool-mode="open"]').click()
    await expect(page.locator('[data-pool-mode="open"]')).toHaveAttribute('aria-pressed', 'true')
    // Combined pool → no per-role headers.
    await expect(page.locator('[data-pool-role-header]')).toHaveCount(0)
    // Switching filtered the whole set to open-queue matches (6).
    await expect.poll(async () => page.locator('.leaf-row').count()).toBe(6)

    await page.locator('[data-pool-mode="quickplay"]').click()
    await expect(page.locator('[data-pool-role-header]')).toHaveCount(0)
    await expect.poll(async () => page.locator('.leaf-row').count()).toBe(5)
  })

  test('Reset appears after a click and clears the band filter (every widget resets)', async ({ page }) => {
    await openBand(page)
    const total = await page.locator('.leaf-row').count()
    // Showing by default — no Reset yet.
    await expect(page.locator('[data-hero-pool-reset]')).toHaveCount(0)

    await page.locator('[data-pool-mode="open"]').click()
    await expect.poll(async () => page.locator('.leaf-row').count()).toBe(6) // narrowed
    const reset = page.locator('[data-hero-pool-reset]')
    await expect(reset).toBeVisible()

    await reset.click()
    // Back to the full set + the Showing state.
    await expect.poll(async () => page.locator('.leaf-row').count()).toBe(total)
    await expect(page.locator('[data-hero-pool-reset]')).toHaveCount(0)
  })

  test('color demands evidence — an 8-game 62% record stays neutral', async ({ page }) => {
    await openBand(page)
    // reinhardt is in-pool at 62% over just 8 games: under the judgment
    // bands that's noise, not a signal, so the bar stays neutral instead
    // of rewarding a small heater. (The classifier itself is unit-tested;
    // this proves the class reaches the DOM.)
    await expect(page.locator('[data-pool-hero="reinhardt"] .hp-fill')).toHaveClass(/cell-mid/)
  })
})
