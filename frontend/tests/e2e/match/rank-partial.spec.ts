/**
 * A rank screenshot the parser could only partly read.
 *
 * The Rank Update block used to be gated on the tier alone, so a capture whose
 * tier band was unreadable — the real case being rank text behind a
 * semi-transparent hero model, now a committed golden fixture — rendered
 * NOTHING. That made a partly-recovered rank screen indistinguishable from a
 * match that never had one, which is the opposite of what the recovery was for.
 *
 * The partial state names what is missing, names the consequence (the match is
 * absent from the rank charts), and offers the fill. That last part is the
 * whole point: `rank` and `level` were already in the override allowlist and
 * already accepted by the server, but no UI anywhere reached them, so the
 * capability existed with no affordance.
 */
import { test, expect } from '../_fixtures'
import type { Route } from '@playwright/test'

function rankRecord(over: Record<string, unknown> = {}) {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'rank' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'defeat',
      date: '2026-08-16', finished_at: '22:00',
      rank: 'platinum', level: 2, rank_progress: 67,
      ...over,
    },
    parsed_at: '2026-08-16T22:30:00Z',
  }
}

async function openBlock(
  page: import('@playwright/test').Page,
  over: Record<string, unknown> = {},
) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([rankRecord(over)]),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await expect(page.locator('.leaf-row')).toHaveCount(1)
  await page.locator('.leaf-row').first().click()
  await expect(page.locator('aside.detail-panel')).toBeVisible()
  return page.locator('.rank-block')
}

test.describe('partially-read rank screen', () => {
  // rank:'' is what the occluded capture actually parses to. Before this the
  // whole block vanished.
  test('still shows the rank update when the tier could not be read', async ({ page }) => {
    const block = await openBlock(page, { rank: '', level: 0 })

    await expect(block).toBeVisible()
    await expect(block).toContainText('Tier not read')
    // Names the consequence, so the user can tell whether it matters to them.
    await expect(block).toContainText(/missing from the rank charts/i)
  })

  test('says nothing about being incomplete when the rank reads cleanly', async ({ page }) => {
    const block = await openBlock(page)

    await expect(block).toContainText('platinum')
    await expect(block).not.toContainText('Tier not read')
    await expect(block).not.toContainText(/missing from the rank charts/i)
  })

  // A division of 0 arrives ABSENT on the wire (level is omitempty), so a match
  // can carry a perfectly good tier and still be missing from every chart. The
  // copy has to name the division rather than claim the tier is unreadable.
  test('names the division when only that is missing', async ({ page }) => {
    const block = await openBlock(page, { level: undefined })

    await expect(block).toContainText('platinum')
    await expect(block).toContainText(/division could not be\s+read/i)
  })

  test('the fill writes the tier and division onto the match', async ({ page }) => {
    let body: string | null = null
    await page.route('**/api/v1/matches/*/data', async (route: Route) => {
      body = route.request().postData()
      await route.fulfill({ status: 204, body: '' })
    })

    const block = await openBlock(page, { rank: '', level: 0 })
    await block.getByLabel('Tier').selectOption('diamond')
    await block.getByLabel('Division').selectOption('3')
    await block.getByRole('button', { name: 'Save rank' }).click()

    await expect.poll(() => body).not.toBeNull()
    const sent = JSON.parse(body ?? '{}') as { rank?: string, level?: number }
    // BOTH, always: the charts need a numeric division as well as a known
    // tier, so a tier-only write would leave the match exactly as invisible.
    expect(sent.rank).toBe('diamond')
    expect(sent.level).toBe(3)
  })

  // The placement-screen shape, moved here from rank-unknown-modifier.spec.ts:
  // rendering the block at all with an empty tier is THIS item's contract.
  test('shows unrecognized modifier text even with no tier', async ({ page }) => {
    const block = await openBlock(page, {
      rank: '', level: 0, modifiers: [], modifiers_raw: 'MOMENTUM',
    })

    await expect(block).toContainText('MOMENTUM')
  })
})
