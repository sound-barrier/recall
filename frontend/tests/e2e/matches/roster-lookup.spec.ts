/**
 * The saved roster, end to end.
 *
 * A BattleTag is what a match's `members` list actually carries, and a tag is
 * not a name. Saving one in Settings makes it read as the name everywhere it
 * was tagged, and completes as you type in a match's Group field.
 *
 * The rule this spec is really about: the roster is a LOOKUP, not a foreign
 * key. Removing somebody stops showing their name; the matches they played on
 * keep the tag.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const TAG = 'Zed#2100'

function match() {
  return {
    match_key: 'match:2026-08-20T20-00-00',
    source_files: ['a.png'],
    data: {
      map: 'rialto', playlist: 'competitive', hero: 'lucio', role: 'support',
      result: 'victory', date: '2026-08-20', finished_at: '20:00',
      played_at_utc: '2026-08-20T20:00:00Z',
      heroes_played: [{ hero: 'lucio', percent_played: 100 }],
    },
    annotation: { match_key: 'match:2026-08-20T20-00-00', members: [TAG] },
    parsed_at: '2026-08-20T23:00:00Z',
  }
}

// The one member chip in the journal's Group cell. Scoped rather than a bare
// text query: the tag also appears in the narrow panel's member facet, and
// what this spec is about is what the CHIP says.
function groupChip(page: import('@playwright/test').Page) {
  return page.locator('aside.detail-panel .member-chip .member-chip-tag')
}

async function mock(page: import('@playwright/test').Page) {
  // The roster lives server-side; this holds it in the route so a save and a
  // remove are observable without a real database.
  let roster: unknown[] = []
  await page.route('**/api/v1/roster', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roster) }))
  await page.route('**/api/v1/roster/*', async (route: Route) => {
    const tag = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '')
    if (route.request().method() === 'DELETE') {
      roster = []
    } else {
      const body = route.request().postDataJSON() as { display_name: string; note: string }
      roster = [{ tag, display_name: body.display_name || tag, note: body.note }]
    }
    await route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([match()]) }))
}

test.describe('roster lookup', () => {
  test('a saved tag reads as the name on the match it was tagged on', async ({ page }) => {
    await mock(page)
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()

    // Before: the Group cell shows the raw tag.
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await expect(groupChip(page)).toHaveText(TAG)

    // Save a name for it.
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByLabel('BattleTag').fill(TAG)
    await page.getByLabel('Name', { exact: true }).fill('Zed')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: 'Remove Zed from the roster' })).toBeVisible()

    // After: the chip carries the name, and the completion offers the tag.
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await expect(groupChip(page)).toHaveText('Zed')
    await expect(page.locator('datalist option[value="Zed#2100"]')).toHaveCount(1)
  })

  test('removing somebody stops showing their name and leaves the match alone', async ({ page }) => {
    await mock(page)
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByLabel('BattleTag').fill(TAG)
    await page.getByLabel('Name', { exact: true }).fill('Zed')
    await page.getByRole('button', { name: 'Save' }).click()

    await page.getByRole('button', { name: 'Remove Zed from the roster' }).click()
    await expect(page.getByText(/Nobody saved yet/)).toBeVisible()

    // The match still carries the tag — un-rostering is not un-tagging.
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await expect(groupChip(page)).toHaveText(TAG)
  })
})
