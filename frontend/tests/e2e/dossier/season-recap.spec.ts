/**
 * The season recap, end to end.
 *
 * One self-contained HTML page a player keeps: the season's record, where the
 * climb started and ended, the heroes and maps behind it. It has to open in
 * any browser with the network off, forever — no scripts, no images, no
 * links, no fonts, nothing that reaches out.
 *
 * A permanent surface, not a once-a-season event: the rollover notice is a
 * nudge onto it, and a recap of any past season is a season pick away. A
 * detector-only feature would be unreachable for eleven months of the year.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const S3 = { name: 'Reign of Talon — Season 3', chapter: 'Reign of Talon', number: 3, start: '2026-06-16T19:00:00Z', end: '2026-08-11T19:00:00Z' }
const S4 = { name: 'Reign of Talon — Season 4', chapter: 'Reign of Talon', number: 4, start: '2026-08-11T19:00:00Z', end: '2126-10-13T19:00:00Z' }

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio', 'Ana'], dps: ['Ashe'], tank: ['Zarya'] },
  maps_by_game_mode: { escort: ['Rialto'], control: ['Ilios'] },
  screenshot_sources: [], seasons: [S3, S4], patches: [], ranks: [],
}

let seq = 0
function match(utc: string, result: string, hero = 'lucio', rank?: { rank: string; level: number }) {
  seq++
  return {
    match_key: `m${seq}`,
    source_files: [`${seq}.png`],
    queue_type: 'role',
    data: {
      map: 'rialto', game_mode: 'escort', playlist: 'competitive', role: 'support',
      hero, result, date: utc.slice(0, 10), finished_at: utc.slice(11, 16),
      played_at_utc: utc, game_length: '14:00',
      heroes_played: [{ hero, percent_played: 100, play_time: '14:00' }],
      ...(rank ?? {}),
    },
    parsed_at: `${utc.slice(0, 10)}T23:00:00Z`,
  }
}

function corpus() {
  seq = 0
  return [
    match('2026-07-01T20:00:00Z', 'victory', 'ana', { rank: 'gold', level: 4 }),
    match('2026-08-20T20:00:00Z', 'victory', 'lucio', { rank: 'gold', level: 2 }),
    match('2026-08-21T20:00:00Z', 'defeat', 'lucio'),
    match('2026-08-22T20:00:00Z', 'victory', 'lucio', { rank: 'platinum', level: 5 }),
  ]
}

async function openCompare(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/system/reference-data', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
  await page.route('**/api/v1/matches', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus()) }))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Compare' }).click()
  await expect(page.getByRole('tabpanel', { name: 'Compare' })).toBeVisible()
}

// The saved page, captured from the browser download the server-mode export
// triggers. The desktop build hands the same bytes to a native dialog.
async function savedRecap(page: import('@playwright/test').Page): Promise<{ name: string; html: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save recap of A' }).click(),
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return { name: download.suggestedFilename(), html: Buffer.concat(chunks).toString('utf-8') }
}

test.describe('season recap', () => {
  test('saves a self-contained page for the season on screen', async ({ page }) => {
    await openCompare(page)
    // Baseline (A) defaults to the older of the two seasons.
    await page.getByLabel('Baseline (A)').selectOption(S4.name)

    const { name, html } = await savedRecap(page)
    expect(name).toBe('recall-recap-reign-of-talon-season-4.html')

    // The season it says it is about, and only that season's games.
    expect(html).toContain('Reign of Talon — Season 4')
    expect(html).toContain('2W-1L')
    expect(html).toContain('Gold 2')
    expect(html).toContain('Platinum 5')

    // It has to open with the network off, forever.
    for (const forbidden of ['<script', 'url(', '@import', '<img', 'http://', 'https://']) {
      expect(html).not.toContain(forbidden)
    }
    expect(html).toContain("default-src 'none'")
    // …and it paints from the app's REAL stylesheets, not a hand-copied
    // subset. Under Vitest the ?inline imports are empty, so this assertion
    // only means anything here.
    expect(html).toContain('--paper')

    await expect(page.getByText(/opens in any browser, with the network off/)).toBeVisible()
  })

  test('recaps a past season too — it is a surface, not a once-a-season event', async ({ page }) => {
    await openCompare(page)
    await page.getByLabel('Baseline (A)').selectOption(S3.name)

    const { name, html } = await savedRecap(page)
    expect(name).toBe('recall-recap-reign-of-talon-season-3.html')
    expect(html).toContain('Reign of Talon — Season 3')
    // One game, a win, on ana — not season 4's three.
    expect(html).toContain('ana')
    expect(html).not.toContain('2W-1L')
  })
})
