/**
 * Match Journal inline tag autocomplete.
 *
 * Once a user has tagged any matches, typing into the Match Journal
 * tag input surfaces a small popover listing tags from the narrowed
 * set's vocabulary (`useMatchesNarrow.availableTags`). Arrow-down +
 * Enter adopts the highlighted suggestion; Enter on free text still
 * adopts as a new tag (the pre-existing behaviour).
 *
 * Mocks the matches feed with two records carrying user-authored
 * tags ("clutch", "stomp") so the vocabulary has something to
 * suggest when the user starts typing into the third (un-tagged)
 * record's input.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEY_BLANK = 'match-2026-05-12T22-00-00'

function record(matchKey: string, tags: string[] = []) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: matchKey.slice(6, 16),
      finished_at: '22:00',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-12T22:30:00Z',
    ...(tags.length ? { annotation: { tags } } : {}),
  }
}

test.describe('match tag autocomplete', () => {
  test('typing surfaces matching suggestions + arrow-down + Enter adopts the highlighted one', async ({ page }) => {
    let blankTags: string[] = []
    let captured: Record<string, unknown> | null = null
    const records = [
      record('match-2026-05-10T22-00-00', ['clutch']),
      record('match-2026-05-11T22-00-00', ['stomp']),
      record(KEY_BLANK, []),
    ]

    await page.route('**/api/v1/matches', async (route: Route) => {
      const live = records.map(r =>
        r.match_key === KEY_BLANK && blankTags.length
          ? { ...r, annotation: { tags: blankTags } }
          : r,
      )
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(live),
      })
    })
    await page.route(`**/api/v1/matches/${encodeURIComponent(KEY_BLANK)}/annotation`, async (route: Route) => {
      captured = JSON.parse(route.request().postData() ?? '{}')
      blankTags = (captured?.tags as string[]) ?? []
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    // The blank-tag record is row index 0 (newest by date).
    await page.locator(`.leaf-row[data-match-key="${KEY_BLANK}"]`).click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    const tagInput = page.locator('.match-tag-input').first()
    await tagInput.focus()
    await tagInput.fill('clu')

    // Suggestions surface with "clutch" as the matching option.
    const suggestions = page.locator('ul.match-tag-suggestions li[role="option"]')
    await expect(suggestions.first()).toContainText('clutch')

    // ArrowDown highlights the first option, Enter adopts it.
    await tagInput.press('ArrowDown')
    await expect(suggestions.first()).toHaveAttribute('aria-selected', 'true')
    await tagInput.press('Enter')

    // The PUT body carries "clutch" as a tag.
    await expect.poll(() => (captured?.tags as string[]) ?? []).toEqual(['clutch'])

    // After the PUT, the suggestions popover is dismissed (the input
    // was cleared) and the chip renders on the record's editor row.
    await expect(page.locator('aside.detail-panel .match-tag.removable')).toContainText('clutch')
  })

  test('Enter on free-text with no cursor still adopts it as a new tag (pre-existing behaviour)', async ({ page }) => {
    let blankTags: string[] = []
    let captured: Record<string, unknown> | null = null
    const records = [
      record('match-2026-05-10T22-00-00', ['clutch']),
      record(KEY_BLANK, []),
    ]

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(records.map(r =>
          r.match_key === KEY_BLANK && blankTags.length
            ? { ...r, annotation: { tags: blankTags } }
            : r,
        )),
      })
    })
    await page.route(`**/api/v1/matches/${encodeURIComponent(KEY_BLANK)}/annotation`, async (route: Route) => {
      captured = JSON.parse(route.request().postData() ?? '{}')
      blankTags = (captured?.tags as string[]) ?? []
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator(`.leaf-row[data-match-key="${KEY_BLANK}"]`).click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    const tagInput = page.locator('.match-tag-input').first()
    await tagInput.focus()
    await tagInput.fill('brand-new')
    // No ArrowDown — cursor stays unset. Enter should adopt as new tag.
    await tagInput.press('Enter')

    await expect.poll(() => (captured?.tags as string[]) ?? []).toEqual(['brand-new'])
  })
})
