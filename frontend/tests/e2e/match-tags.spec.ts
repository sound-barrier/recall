/**
 * Match-tags E2E.
 *
 * Tags are stored as a child of the match annotation (mirroring the
 * existing `members` field). The full flow exercised here is:
 *
 *   1. user expands a match card
 *   2. clicks the `stack` quick-add toggle in the inline tags editor
 *   3. UI fires PUT /api/v1/matches/{matchKey}/annotation with
 *      `{ ..., tags: ["stack"] }`
 *   4. App.vue re-fetches /api/v1/matches; the chip renders on the card
 *   5. FilterRail's Tags multi-select shows `stack`; selecting it
 *      narrows the visible match list to the tagged record (OR
 *      semantics across multiple selected tags).
 *
 * Same `page.route()` mocking pattern as match-deletion.spec.ts —
 * tracks state in closure-captured `tags` so subsequent GETs see the
 * updated annotation.
 */
import { test, expect, type Route } from '@playwright/test'

const KEY = 'match:2026-05-10T22:00:00'
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
  test('quick-add `stack` tag persists + chip renders on the card', async ({ page }) => {
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
    await page.locator('.match').first().locator('.chev-btn').click()

    // The quick-add buttons are toggle controls — one per named tag.
    // Data-attribute selectors are cheaper + more durable than aria
    // labels for tag values that may localise later.
    await page.locator('button[data-tag-add="stack"]').click()

    // The PUT body carries the full annotation row with `tags`.
    await expect.poll(() => (captured?.tags as string[]) ?? []).toEqual(['stack'])

    // After the post-PUT reload, the chip appears on the card.
    await expect(page.locator('.match-tag').filter({ hasText: /stack/i })).toBeVisible()
  })

  test('FilterRail Tags filter — OR-narrows to matching cards', async ({ page }) => {
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
    await expect(page.locator('.match')).toHaveCount(3)

    // Open the Tags filter and pick `stack`. The filter trigger is the
    // shared MultiSelectField shape used by Mode/Map/Hero/etc., so
    // `aria-label="Tags filter, …"` is the stable selector.
    await page.locator('button[aria-label*="Tags filter"]').click()
    await page.locator('.mf-row', { hasText: 'stack' }).click()
    // Close the popover so the card grid is the only foreground.
    await page.keyboard.press('Escape')

    // Only the `stack`-tagged match remains.
    await expect(page.locator('.match')).toHaveCount(1)
    await expect(page.locator('.match .match-tag').filter({ hasText: /stack/i })).toBeVisible()
  })
})
