/**
 * Match-search E2E.
 *
 * The Narrow panel's `#np-search` input substring-matches
 * (case-insensitive) across every lexical surface of a match:
 * map, playlist, hero, role, type, annotation.note, every
 * heroes_played[].hero, and annotation.tags.
 *
 * Pre-redesign this spec covered a vim-style field-scoped clause
 * syntax (`note:foo`, `tag:bar`, `member:apollo`, `replay:7H1`).
 * That syntax is gone — the narrow-panel search is intentionally
 * simpler, a single substring against the joined blob. The
 * scoped-clause coverage moves to the per-dimension chip pickers
 * exercised in `match-tags.spec.ts` and `matches-set-workspace.spec.ts`.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface RecordOpts {
  note?: string
  tags?: string[]
}

function record(matchKey: string, hero: string, opts: RecordOpts = {}) {
  const annotation: Record<string, unknown> = {}
  if (opts.note) annotation.note = opts.note
  if (opts.tags) annotation.tags = opts.tags
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      type: 'control',
      role: 'support',
      hero,
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero, percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...(Object.keys(annotation).length ? { annotation } : {}),
  }
}

// Four-record corpus seeded for cross-field search. Each record has
// a distinct hero + one annotation field (or none) so a query that
// matches multiple records can only do so via the joined-blob
// semantics.
const CORPUS = [
  record('match:1', 'lucio',  { note: 'huge clutch on the second point' }),
  record('match:2', 'juno',   { tags: ['stack'] }),
  record('match:3', 'kiriko'),
  record('match:4', 'mercy',  { note: 'team threw the lead' }),
]

async function openNarrow(page: import('@playwright/test').Page) {
  await page.locator('[data-narrow-trigger]').click()
  await expect(page.locator('#narrow-popover')).toBeVisible()
}

function searchInput(page: import('@playwright/test').Page) {
  return page.locator('#np-search')
}

test.describe('match search — narrow-panel substring filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(4)
  })

  test('hero name substring narrows to the matching record', async ({ page }) => {
    await openNarrow(page)
    await searchInput(page).fill('lucio')
    // Filter applies live; close the popover to reveal the leaves
    // list underneath the modal.
    await page.locator('.np-close').click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })

  test('note substring hits annotation.note', async ({ page }) => {
    await openNarrow(page)
    await searchInput(page).fill('clutch')
    await page.locator('.np-close').click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })

  test('tag value substring hits annotation.tags', async ({ page }) => {
    await openNarrow(page)
    await searchInput(page).fill('stack')
    await page.locator('.np-close').click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })

  test('case-insensitive', async ({ page }) => {
    await openNarrow(page)
    await searchInput(page).fill('CLUTCH')
    await page.locator('.np-close').click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })

  test('clearing the input restores the full corpus', async ({ page }) => {
    await openNarrow(page)
    await searchInput(page).fill('clutch')
    await searchInput(page).fill('')
    await page.locator('.np-close').click()
    await expect(page.locator('.leaf-row')).toHaveCount(4)
  })

  test('no hits → empty members list with the "clear narrowing" affordance', async ({ page }) => {
    await openNarrow(page)
    await searchInput(page).fill('not-a-substring-in-any-record')
    await page.locator('.np-close').click()
    await expect(page.locator('.leaf-row')).toHaveCount(0)
    await expect(page.locator('.leaves-empty')).toContainText('No matches in this set')
    // The narrow-reset affordance surfaces because anyNarrow is true.
    await expect(page.locator('.leaves-empty-btn')).toBeVisible()
  })

  test('the active-clause chip rail surfaces the search clause for at-a-glance review', async ({ page }) => {
    await openNarrow(page)
    await searchInput(page).fill('clutch')
    await page.locator('.np-close').click()
    // The dossier renders one chip per active filter dimension; the
    // search clause is the one with class `active-chip.search`.
    const chip = page.locator('.active-chip.search')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('clutch')
  })

  test('the active-chip × removes the search clause and restores the corpus', async ({ page }) => {
    await openNarrow(page)
    await searchInput(page).fill('clutch')
    await page.locator('.np-close').click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)

    // Click the × inside the search chip.
    await page.locator('.active-chip.search .chip-x').click()
    await expect(page.locator('.leaf-row')).toHaveCount(4)
    await expect(page.locator('.active-chip.search')).toHaveCount(0)
  })
})
