/**
 * "Report parse problem…" — the one export for every kind of bad parse.
 *
 * Opened from the failed list (screenshots that errored) or a match's
 * Source Screenshots (ones that parsed wrong). The dialog shows the
 * preflight's likely causes first, takes a note per file, POSTs only the
 * ticked files to /api/v1/exports/diagnostic, blob-downloads the zip, then
 * offers a GitHub issue prefilled from the notes. Wails mode routes the
 * save through the native dialog instead — unit-covered.
 */
import type { Route } from '@playwright/test'

import { routeCapture } from '../_capture'
import { test, expect } from '../_fixtures'

interface ReportBody {
  files: { filename: string; screenshots_dir_id: number; note: string }[]
}

const failedRows = () => ([
  {
    filename: 'corrupt.png',
    error: 'decoding image: png: invalid format',
    attempts: 6,
    parked: false,
    first_failed_at: '2026-07-01T20:00:00Z',
    last_failed_at: '2026-07-06T21:30:00Z',
  },
])

const misreadMatch = () => ({
  match_key: 'match-2026-05-10T22-00-00',
  source_files: ['summary.png', 'teams.png'],
  source_types: { 'summary.png': 'summary', 'teams.png': 'teams' },
  source_dir_ids: { 'summary.png': 3, 'teams.png': 3 },
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio',
    result: 'victory', date: '2026-05-10', finished_at: '22:00',
    eliminations: 17, assists: 16, deaths: 11, damage: 7200,
    heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
  },
  parsed_at: '2026-05-10T22:30:00Z',
})

async function stubExport(page: import('@playwright/test').Page) {
  const body = routeCapture<ReportBody>()
  await page.route('**/api/v1/exports/diagnostic', async (route: Route) => {
    body.set(JSON.parse(route.request().postData() ?? '{}') as ReportBody)
    await route.fulfill({
      status: 200,
      contentType: 'application/zip',
      headers: { 'Content-Disposition': 'attachment; filename="recall-diagnostic-test.zip"' },
      body: Buffer.from('PK'),
    })
  })
  return body
}

test.describe('Report parse problem', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/exports/diagnostic/preflight', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ likely_causes: [{
          code: 'tesseract_unsupported',
          message: 'Tesseract 4.1.1 is installed. Recall is tuned for 5.x.',
        }] }),
      })
    })
    await page.context().route('https://github.com/**', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>issue</title>' })
    })
  })

  test('from the failed list: note, save, then a prefilled issue', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route('**/api/v1/screenshots/failed', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(failedRows()) })
    })
    const body = await stubExport(page)

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()
    await page.getByRole('button', { name: 'Report parse problem…' }).click()

    const dialog = page.getByRole('dialog', { name: 'Report a parse problem' })
    await expect(dialog.getByText('Tesseract 4.1.1 is installed. Recall is tuned for 5.x.')).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: 'Include corrupt.png' })).toBeChecked()
    await dialog.getByRole('textbox', { name: 'What’s wrong with corrupt.png?' }).fill('this is a SUMMARY tab')

    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Save report…' }).click()
    expect((await download).suggestedFilename()).toBe('recall-diagnostic-test.zip')
    expect(body.get()).toEqual({ files: [{ filename: 'corrupt.png', screenshots_dir_id: 0, note: 'this is a SUMMARY tab' }] })

    const popup = page.waitForEvent('popup')
    await dialog.getByRole('button', { name: 'Open a GitHub issue' }).click()
    const issue = new URL((await popup).url())
    expect(issue.pathname).toBe('/sound-barrier/recall/issues/new')
    expect(issue.searchParams.get('template')).toBe('parse_problem.yml')
    expect(issue.searchParams.get('files')).toContain('corrupt.png: this is a SUMMARY tab')
  })

  test('from a match’s sources: only the ticked files, with their folder', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([misreadMatch()]) })
    })
    const body = await stubExport(page)

    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.locator('.leaf-row').first().click()
    await page.locator('aside.detail-panel').getByText('Source Screenshots').click()
    await page.getByRole('button', { name: 'Report parse problem…' }).click()

    const dialog = page.getByRole('dialog', { name: 'Report a parse problem' })
    await dialog.getByRole('checkbox', { name: 'Include teams.png' }).uncheck()
    await dialog.getByRole('textbox', { name: 'What’s wrong with summary.png?' }).fill('hero should be Kiriko')

    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Save report…' }).click()
    await download
    expect(body.get()).toEqual({ files: [{ filename: 'summary.png', screenshots_dir_id: 3, note: 'hero should be Kiriko' }] })
  })

  test('no failed files, no report button on the failed list', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route('**/api/v1/screenshots/failed', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    await expect(page.getByRole('tabpanel', { name: /^Unknown/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Report parse problem…' })).toHaveCount(0)
  })
})
