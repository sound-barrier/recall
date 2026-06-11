/**
 * Match-search E2E.
 *
 * The Narrow panel's `#np-search` input parses a vim/less-style query
 * (`search-query.ts`):
 *
 *   • bare token        → substring across the broad lexical blob
 *                         (map, playlist, hero, role, game_mode, note,
 *                         heroes_played[].hero, tags, members,
 *                         replay_code)
 *   • <field>:<value>   → only that annotation surface
 *                         (note, tag[s], member[s], replay[s])
 *
 * Multiple clauses AND together. F1 restored the scoped syntax that an
 * earlier redesign had collapsed to a plain blob substring; the matching
 * surfaces visible in a leaf row (map, hero, tags) also get the matched
 * substring highlighted via `<mark class="leaf-hl">`.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface RecordOpts {
  map?: string
  note?: string
  tags?: string[]
  members?: string[]
  replay?: string
}

function record(matchKey: string, hero: string, opts: RecordOpts = {}) {
  const annotation: Record<string, unknown> = {}
  if (opts.note) annotation.note = opts.note
  if (opts.tags) annotation.tags = opts.tags
  if (opts.members) annotation.members = opts.members
  if (opts.replay) annotation.replay_code = opts.replay
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: opts.map ?? 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
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

// Cross-field corpus: "rialto" lives in match:1's MAP and match:2's
// NOTE, so a bare `rialto` hits both while `note:rialto` isolates the
// note. Each scoped surface (tag/member/replay) is seeded on a distinct
// record so a `field:` query can only match via that surface.
const CORPUS = [
  record('match:1', 'lucio',  { map: 'rialto', note: 'huge clutch on the second point' }),
  record('match:2', 'juno',   { map: 'ilios',  tags: ['stack'], note: 'rialto angles were rough' }),
  record('match:3', 'kiriko', { map: 'nepal',  members: ['Apollo#1234'] }),
  record('match:4', 'mercy',  { map: 'busan',  replay: '7H1XYZ', note: 'team threw the lead' }),
]

async function openNarrow(page: Page) {
  await page.locator('[data-narrow-trigger]').click()
  await expect(page.locator('#narrow-popover')).toBeVisible()
}

function searchInput(page: Page) {
  return page.locator('#np-search')
}

// Fill the search, then close the popover so the (inert-while-open)
// leaves list underneath is interactable / assertable.
async function search(page: Page, query: string) {
  await openNarrow(page)
  await searchInput(page).fill(query)
  await page.locator('.np-close').click()
}

function row(page: Page, matchKey: string) {
  return page.locator(`.leaf-row[data-match-key="${matchKey}"]`)
}

test.describe('match search — narrow-panel scoped-clause filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(4)
  })

  // ── Bare tokens — broad blob (regression guards) ──────────────────
  test('bare hero name narrows to the matching record', async ({ page }) => {
    await search(page, 'lucio')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })

  test('bare token hits a note substring', async ({ page }) => {
    await search(page, 'clutch')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })

  test('bare token spans every surface (map OR note)', async ({ page }) => {
    // "rialto" is match:1's map and appears in match:2's note → both.
    await search(page, 'rialto')
    await expect(page.locator('.leaf-row')).toHaveCount(2)
  })

  test('bare token is case-insensitive', async ({ page }) => {
    await search(page, 'CLUTCH')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })

  // ── Scoped clauses — single annotation surface ────────────────────
  test('note: isolates the annotation note (excludes the map hit)', async ({ page }) => {
    // Only match:2 has "rialto" in its NOTE; match:1 has it as the map.
    await search(page, 'note:rialto')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(row(page, 'match:2')).toBeVisible()
  })

  test('tag: matches only the tag surface', async ({ page }) => {
    await search(page, 'tag:stack')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(row(page, 'match:2')).toBeVisible()
  })

  test('member: matches a group-member BattleTag, case-insensitively', async ({ page }) => {
    await search(page, 'member:apollo')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(row(page, 'match:3')).toBeVisible()
  })

  test('replay: matches the replay code, case-insensitively', async ({ page }) => {
    await search(page, 'replay:7h1')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(row(page, 'match:4')).toBeVisible()
  })

  test('multiple clauses AND together', async ({ page }) => {
    // match:2 is the only record with BOTH "rialto" in its note and the
    // "stack" tag.
    await search(page, 'note:rialto tag:stack')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(row(page, 'match:2')).toBeVisible()
  })

  // ── Highlighting visible surfaces ─────────────────────────────────
  test('a bare map hit highlights the map cell', async ({ page }) => {
    await search(page, 'rialto')
    await expect(row(page, 'match:1').locator('.leaf-map mark.search-hl')).toHaveText('rialto')
  })

  test('a bare hero hit highlights the hero cell', async ({ page }) => {
    await search(page, 'lucio')
    await expect(row(page, 'match:1').locator('.leaf-hero mark.search-hl')).toHaveText('lucio')
  })

  test('a tag: hit highlights the matching tag chip', async ({ page }) => {
    await search(page, 'tag:stack')
    await expect(row(page, 'match:2').locator('.leaf-tag mark.search-hl')).toHaveText('stack')
  })

  test('a note:-scoped hit does NOT bleed highlight into the visible row', async ({ page }) => {
    // match:2 matches via its note (not shown in the row); its map
    // (ilios) / hero (juno) / tags (stack) contain no "rialto", so the
    // row carries no highlight mark.
    await search(page, 'note:rialto')
    await expect(row(page, 'match:2').locator('mark.search-hl')).toHaveCount(0)
  })

  // ── Clear / empty / active-chip (unchanged behaviour) ─────────────
  test('clearing the input restores the full corpus', async ({ page }) => {
    await openNarrow(page)
    await searchInput(page).fill('clutch')
    await searchInput(page).fill('')
    await page.locator('.np-close').click()
    await expect(page.locator('.leaf-row')).toHaveCount(4)
  })

  test('no hits → empty members list with the "clear narrowing" affordance', async ({ page }) => {
    await search(page, 'not-a-substring-in-any-record')
    await expect(page.locator('.leaf-row')).toHaveCount(0)
    await expect(page.locator('.leaves-empty')).toContainText('No matches in this set')
    await expect(page.locator('.leaves-empty-btn')).toBeVisible()
  })

  test('the active-clause chip surfaces the raw query for at-a-glance review', async ({ page }) => {
    await search(page, 'note:rialto')
    const chip = page.locator('.active-chip.search')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('note:rialto')
  })

  test('the active-chip × clears the search and restores the corpus', async ({ page }) => {
    await search(page, 'tag:stack')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await page.locator('.active-chip.search .chip-x').click()
    await expect(page.locator('.leaf-row')).toHaveCount(4)
    await expect(page.locator('.active-chip.search')).toHaveCount(0)
  })
})
