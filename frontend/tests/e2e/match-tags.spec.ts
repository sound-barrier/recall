/**
 * Match-tags E2E.
 *
 * Tags are stored as a child of the match annotation. The full flow:
 *
 *   1. user clicks a `.leaf-row` → MatchDetailPanel opens
 *   2. inside the panel, clicks the `stack` quick-add button
 *   3. UI fires `PUT /api/v1/matches/{matchKey}/annotation` with
 *      `{ ..., tags: ["stack"] }`
 *   4. App.vue re-fetches `/api/v1/matches`; the tag chip renders
 *      on the matching `.leaf-row` (as `.leaf-tag`)
 *   5. opening the Narrow panel surfaces `#stack` as a tag chip;
 *      clicking it narrows the leaves list to the tagged record
 *
 * Same `page.route()` mocking pattern as match-deletion.spec.ts —
 * tracks state in closure-captured `tags` so subsequent GETs see
 * the updated annotation.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEY = 'match-2026-05-10T22-00-00'
const KEY_ENCODED = encodeURIComponent(KEY)
const ANNOTATION_PATH_GLOB = `**/api/v1/matches/${KEY_ENCODED}/annotation`

function record(matchKey: string, tags: string[] = []) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...(tags.length ? { annotation: { tags } } : {}),
  }
}

test.describe('match tags — inline editor + filter', () => {
  test('quick-add `stack` tag persists + chip renders on the row', async ({ page }) => {
    let tags: string[] = []
    let captured: Record<string, unknown> | null = null

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(KEY, tags)]),
      })
    })
    await page.route(ANNOTATION_PATH_GLOB, async (route: Route) => {
      captured = JSON.parse(route.request().postData() ?? '{}')
      tags = (captured?.tags as string[]) ?? []
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // The quick-add buttons are toggle controls — one per named tag.
    // Data-attribute selectors are cheaper + more durable than text.
    await page.locator('button[data-tag-add="stack"]').click()

    // The PUT body carries the full annotation row with `tags`.
    await expect.poll(() => (captured?.tags as string[]) ?? []).toEqual(['stack'])

    // After the post-PUT reload, the chip appears on the leaf-row.
    // The MatchDetailPanel is still open over the row; close it so
    // the leaf-row is visible to the assertion.
    await page.keyboard.press('Escape')
    await expect(page.locator('.leaf-row .leaf-tag')).toContainText('stack')
  })

  test('Narrow panel Tags chip — picking `#stack` narrows to tagged rows', async ({ page }) => {
    const records = [
      record('match:1', ['stack']),
      record('match:2', ['stream']),
      record('match:3', []),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(records),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // Open the Narrow panel via the dossier trigger. The tag chips
    // live inside `.np-section` blocks under the "Tags" eyebrow.
    await page.locator('[data-narrow-trigger]').click()
    await expect(page.locator('#narrow-popover')).toBeVisible()
    await page.locator('.np-chip', { hasText: '#stack' }).click()

    // Only the `stack`-tagged match remains.
    await expect(page.locator('#narrow-popover .np-chip.picked', { hasText: '#stack' })).toBeVisible()
    // Close the popover so the chip + visible leaves are the only
    // foreground.
    await page.locator('.np-close').click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(page.locator('.leaf-row .leaf-tag')).toContainText('stack')
  })
})
