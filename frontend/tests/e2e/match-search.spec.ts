/**
 * Global match-search E2E.
 *
 * Supersedes the original `match-notes-search.spec.ts` semantics —
 * the FilterRail's search input now matches across every annotation
 * field (note + replay_code + members + tags), and accepts vim-style
 * field-scoped clauses via the `<field>:<value>` prefix syntax. The
 * spec drives the live filter through every shape:
 *
 *   • bare term hits ANY of the four fields
 *   • `note:foo` only hits note
 *   • `replay:7H1`, `member:Apollo`, `tag:stack` likewise
 *   • multiple clauses AND together
 *   • quoted values preserve internal whitespace
 *
 * The hit-highlighting behaviour on the expanded card stays covered
 * by `match-notes-search.spec.ts` (kept for the highlight contract).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface RecordOpts {
  note?: string
  replay?: string
  members?: string[]
  tags?: string[]
}

function record(matchKey: string, opts: RecordOpts = {}) {
  const annotation: Record<string, unknown> = {}
  if (opts.note) annotation.note = opts.note
  if (opts.replay) annotation.replay_code = opts.replay
  if (opts.members) annotation.members = opts.members
  if (opts.tags) annotation.tags = opts.tags
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
    ...(Object.keys(annotation).length ? { annotation } : {}),
  }
}

// Four-record corpus seeded for cross-field search. Each record carries
// exactly one annotation field so a clause that matches MULTIPLE records
// can only do so via the global-search semantics, not via a single
// shared field.
const CORPUS = [
  record('match:1', { note: 'huge clutch on the second point' }),
  record('match:2', { replay: '7H1K9P' }),
  record('match:3', { members: ['Apollo#11234'] }),
  record('match:4', { tags: ['stack'] }),
]

test.describe('match search — global + field-scoped syntax', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.match')).toHaveCount(4)
  })

  // The input's aria-label is the stable selector. It changed from
  // "Search match notes" → "Search matches" to reflect the new scope.
  function searchInput(page: import('@playwright/test').Page) {
    return page.locator('input[aria-label="Search matches"]')
  }

  test('bare term hits any annotation field', async ({ page }) => {
    // "clutch" only appears in match:1's note → narrows to that one.
    await searchInput(page).fill('clutch')
    await expect(page.locator('.match')).toHaveCount(1)

    await searchInput(page).fill('7H1K9P')
    await expect(page.locator('.match')).toHaveCount(1)

    await searchInput(page).fill('apollo')
    await expect(page.locator('.match')).toHaveCount(1)

    await searchInput(page).fill('stack')
    await expect(page.locator('.match')).toHaveCount(1)
  })

  test('field-scoped `note:` only hits notes', async ({ page }) => {
    // "clutch" is in match:1's note → narrows to 1.
    await searchInput(page).fill('note:clutch')
    await expect(page.locator('.match')).toHaveCount(1)

    // "stack" only exists as a tag value — scoping to note returns 0.
    await searchInput(page).fill('note:stack')
    await expect(page.locator('.match')).toHaveCount(0)
  })

  test('field-scoped `replay:` only hits replay codes', async ({ page }) => {
    await searchInput(page).fill('replay:7H1')
    await expect(page.locator('.match')).toHaveCount(1)

    await searchInput(page).fill('replay:clutch')
    await expect(page.locator('.match')).toHaveCount(0)
  })

  test('field-scoped `member:` only hits members', async ({ page }) => {
    // Substring match on BattleTag (case-insensitive).
    await searchInput(page).fill('member:apollo')
    await expect(page.locator('.match')).toHaveCount(1)

    await searchInput(page).fill('member:stack')
    await expect(page.locator('.match')).toHaveCount(0)
  })

  test('field-scoped `tag:` only hits tags', async ({ page }) => {
    await searchInput(page).fill('tag:stack')
    await expect(page.locator('.match')).toHaveCount(1)

    await searchInput(page).fill('tag:apollo')
    await expect(page.locator('.match')).toHaveCount(0)
  })

  test('multiple clauses AND together', async ({ page }) => {
    // Add a record that satisfies BOTH `tag:stack` AND `note:clutch`.
    const enriched = [
      ...CORPUS,
      record('match:5', { note: 'clutch hold', tags: ['stack'] }),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(enriched) })
    })
    await page.reload()
    await page.locator('#tab-matches').click()
    await expect(page.locator('.match')).toHaveCount(5)

    await searchInput(page).fill('tag:stack note:clutch')
    // Only match:5 carries both — the others fail one or the other.
    await expect(page.locator('.match')).toHaveCount(1)
  })

  test('quoted values preserve whitespace', async ({ page }) => {
    // `huge clutch` is two words; without quoting, the second word
    // becomes its own clause and changes the AND set.
    await searchInput(page).fill('note:"huge clutch"')
    await expect(page.locator('.match')).toHaveCount(1)
  })

  test('clearing the input restores all matches', async ({ page }) => {
    await searchInput(page).fill('note:clutch')
    await expect(page.locator('.match')).toHaveCount(1)
    await page.locator('button[aria-label="Clear search"]').click()
    await expect(searchInput(page)).toHaveValue('')
    await expect(page.locator('.match')).toHaveCount(4)
  })

  test('unknown field prefix falls through to bare-text search', async ({ page }) => {
    // `bogus:foo` isn't a known field — should match the literal text
    // "bogus:foo" against any field. No record carries it → 0.
    await searchInput(page).fill('bogus:foo')
    await expect(page.locator('.match')).toHaveCount(0)
  })

  test('parsed-clause chips render below the input as visual confirmation', async ({ page }) => {
    await searchInput(page).fill('note:clutch tag:stack')
    // Two clause chips, one per scoped clause.
    const chips = page.locator('.match-search-clause')
    await expect(chips).toHaveCount(2)
    await expect(chips.nth(0)).toContainText(/note/i)
    await expect(chips.nth(0)).toContainText(/clutch/i)
    await expect(chips.nth(1)).toContainText(/tag/i)
    await expect(chips.nth(1)).toContainText(/stack/i)
  })

  // Vim-style cancel: `/` opens the search "mode" by focusing the
  // input; `<Esc>` should cancel that mode — clear the query and blur
  // the input — so the user gets back to "normal mode" without
  // reaching for the mouse. Previously Esc was a no-op inside the
  // input, which left users stranded in the search row.
  test('Esc in the search input clears the query AND blurs', async ({ page }) => {
    const input = searchInput(page)
    // `note:clutch` narrows to match:1 (the only note containing "clutch").
    await input.fill('note:clutch')
    await expect(page.locator('.match')).toHaveCount(1)
    await expect(input).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(input).toHaveValue('')
    await expect(input).not.toBeFocused()
    // Filter restored — the global corpus comes back.
    await expect(page.locator('.match')).toHaveCount(4)
  })

  test('Esc on an empty search input still blurs', async ({ page }) => {
    const input = searchInput(page)
    await input.focus()
    await expect(input).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(input).not.toBeFocused()
  })

  // `/` from anywhere focuses the input; `<Esc>` then takes the user
  // straight out. Round-trip confirms the two halves play together.
  test('/ then Esc → in and out of the search row without mouse', async ({ page }) => {
    // Start focus outside the input (the masthead brand is a stable
    // outside-of-input anchor).
    await page.locator('.brand').first().click()
    await page.keyboard.press('/')
    await expect(searchInput(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(searchInput(page)).not.toBeFocused()
  })
})
