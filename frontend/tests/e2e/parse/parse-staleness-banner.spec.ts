/**
 * Parse-staleness notice — "N matches were read by an older parser".
 *
 * A parser improvement only ever reaches files parsed AFTER it ships. Nothing
 * used to say so, so a fix landed silently on new captures while the existing
 * history kept its old readings, and the dossier and Trends numbers directly
 * below this banner were drawn across both vintages with no indication. The
 * only cure — Re-parse All — was buried in Settings → Advanced, where a user
 * with no reason to suspect anything would never go looking.
 *
 * e2e rather than a component test because the value has to survive the whole
 * chain: OpenAPI schema → generated SDK → query cache → store → composable →
 * render. A component test passes with the endpoint missing entirely.
 */
import { test, expect } from '../_fixtures'
import type { Route } from '@playwright/test'

function matchRecord(matchKey: string) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'victory',
      date: '2026-08-16', finished_at: '22:00',
    },
    parsed_at: '2026-08-16T22:30:00Z',
  }
}

async function mockStaleness(page: import('@playwright/test').Page, staleMatches: number) {
  await page.route('**/api/v1/system/parse-staleness', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ stale_matches: staleMatches, parser_generation: 3 }),
    })
  })
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([matchRecord('m1')]),
    })
  })
}

// The CI runner has no Tesseract, and onReParseAll early-returns when the
// binary is missing — so a CTA test that skipped this would assert on a click
// that was refused before it reached the transport. Same trap, same fix as
// settings/settings-reparse-all.spec.ts.
async function mockTesseractFound(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        path: '/opt/homebrew/bin/tesseract',
        found: true, version: '5.3.4', supported: true,
        error: '', platform: 'darwin',
      }),
    })
  })
}

test.describe('parse staleness notice', () => {
  test('names how many matches an older parser read', async ({ page }) => {
    await mockStaleness(page, 42)
    await page.goto('/')

    const notice = page.getByRole('status', { name: /older parser/i })
    await expect(notice).toBeVisible()
    // The COUNT is the actionable part — "some matches" would not tell the
    // user whether this is worth a re-parse.
    await expect(notice).toContainText('42')
    await expect(notice.getByRole('button', { name: /re-parse all now/i })).toBeVisible()
  })

  // The clean case must be silent. An empty or zero-valued banner is a
  // permanent nag that trains the user to ignore the real one.
  test('shows nothing when every match is current', async ({ page }) => {
    await mockStaleness(page, 0)
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()

    await expect(page.getByRole('status', { name: /older parser/i })).toHaveCount(0)
  })

  test('the call to action re-parses every screenshot', async ({ page }) => {
    await mockStaleness(page, 42)
    await mockTesseractFound(page)
    let reparseUrl: string | null = null
    await page.route('**/api/v1/parses*', async (route: Route) => {
      reparseUrl = route.request().url()
      await route.fulfill({ status: 202, body: '' })
    })

    await page.goto('/')
    await page.getByRole('status', { name: /older parser/i })
      .getByRole('button', { name: /re-parse all now/i }).click()

    await expect.poll(() => reparseUrl).not.toBeNull()
    // scope=all is what re-reads the whole folder; a plain parse would skip
    // every file already in the database and fix nothing.
    expect(reparseUrl).toContain('scope=all')
  })

  // Dismissal is a requirement, not polish: a user whose original screenshots
  // are no longer on disk can never drive the count to zero, so without this
  // the notice would nag forever with no action that could clear it.
  test('stays dismissed across a reload', async ({ page }) => {
    await mockStaleness(page, 42)
    await page.goto('/')

    const notice = page.getByRole('status', { name: /older parser/i })
    await expect(notice).toBeVisible()
    await notice.getByRole('button', { name: /dismiss/i }).click()
    await expect(notice).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    await expect(page.getByRole('status', { name: /older parser/i })).toHaveCount(0)
  })
})
